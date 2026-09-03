/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { Type } from '@google/genai';
import { installUserSystem } from './server/lib/routes';
import { getLLMClientForRequest } from './server/lib/llm';
import { assertSafeHttpUrl } from './server/lib/net';
import { createServer as createViteServer } from 'vite';
import { createRequire } from 'module';
import * as XLSX from 'xlsx';
const require = createRequire(path.join(process.cwd(), 'app.js')); // 兼容 CJS 打包产物（import.meta 在 cjs 下为空）
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Initialize express middlewares with higher limits for base64 file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 用户系统：全局鉴权门卫 + 账号数据/LLM 配置路由（见 server/lib/routes.ts）
installUserSystem(app);

// Robust JSON parsing utility to clean markdown fences (e.g. ```json) and parse safely
function safeJSONParse<T = any>(text: string): T {
  if (!text) return {} as T;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error('Failed to parse JSON. Raw response length:', text.length, 'Error:', err);
    throw err;
  }
}

// ----------------- API ENDPOINTS -----------------

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: 'ok',
    signup: process.env.PUBLIC_SIGNUP !== 'false',
  });
});

/// 0. AI Word Lookup (智能单词检索)
app.post('/api/gemini/word-lookup', async (req, res) => {
  try {
    const { word, category } = req.body;
    if (!word) {
      return res.status(400).json({ error: 'Word is required' });
    }

    // Determine specific module instructions
    let moduleEnforcement = '';
    let moduleTargetDesc = '';

    if (category && ['reading', 'writing', 'speaking', 'listening'].includes(category)) {
      moduleEnforcement = `8. category 必须是 且只能是: '${category}'。`;
      if (category === 'writing') {
        moduleTargetDesc = `\n[特别针对 ✍️ 雅思学术写作 模块的要求]:
- 该单词的释义和用法需着重体现其在雅思写作（Task 1/2）学术文章或议论文中的高分词汇属性。
- example 例句必须是一个非常高质量、符合学术大作文（Task 2）考场真题满分水平的高学术性、逻辑缜密、结构规范的学术写作范文级句子（可适当采用主语从句、非谓语动词或倒装句等高分语法特征）。`;
      } else if (category === 'speaking') {
        moduleTargetDesc = `\n[特别针对 🗣️ 雅思口语 模块的要求]:
- 该单词的释义和用法需体现其在雅思口语（Part 1/2/3）真实沟通中的高分地道口头表达。
- example 例句必须是一个自然流利、有场景感、极富交流张力的口语高分答题级句子（可包含口语惯用法、副词修饰、地道口语搭配，让句子听起来像一个地道、得体且高分的英语母语者口头陈述，避免过于干瘪或死板的学术长句）。`;
      } else if (category === 'reading') {
        moduleTargetDesc = `\n[特别针对 📖 雅思阅读 模块的要求]:
- 该单词的释义 and 用法需聚焦于其在雅思阅读学术类文献、科普文章、真题长难句中的词意深度、熟词僻义、核心同义替换（paraphrasing）属性。
- example 例句必须是一个类似雅思阅读真题学术段落的句子（包含长难句特征，如同位语、后置定语、复合从句、被动语态等），以便用户在精读时能重点体悟语法拆解与主谓宾抓取。`;
      } else if (category === 'listening') {
        moduleTargetDesc = `\n[特别针对 🎧 雅思听力 模块的要求]:
- 该单词的释义和用法需突出其作为雅思听力高频拼写、听写考点或核心定位替换词的属性。
- example 例句应该像一个典型的雅思听力真题听力原文（可以是学术讲座Lecture独白场景或日常对话场景），注重发音连读、失去爆破等常见拼读听力场景，例句可采用独白或对话引出考点的经典出题结构。`;
      }
    } else {
      moduleEnforcement = `8. category 必须是且只能是这四个之一：'reading' (阅读词汇), 'writing' (写作词汇), 'speaking' (口语词汇), 'listening' (听力词汇)。请根据该词最常用或最推荐的备考科目作归类。`;
      moduleTargetDesc = `\n[通用的雅思备考要求]:
- 针对雅思考试高分特色，分析该单词最常用、最推荐被收录的科目属性（如高分学术词推荐归入写作或阅读，地道口头习惯词归入口语，高频拼写词归入听力）。
- 雅思例句（example）应极具真实考场场景，并附带精确得体的中文例句翻译（exampleTranslation），杜绝平庸生硬。`;
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个权威的雅思官方词典专家，请为单词或词组 "${word}" 生成规范的雅思（IELTS）学术词书属性。
注意：很多英语单词含有多重意思和词性。请完整总结该词在雅思考试（学术类及培训类）中所有的常见意思及词性，以及该词高频的、地道的雅思核心词组搭配（collocations / phrases）。

要求：
1. 提取或给出该词最标准、最具代表性的属性（作为主释义）。
2. phonetic 字段必须使用符合国际音标的写法（例如：/mɪˈtɪkjələs/ 或 /ˌækəˈdemɪk/）。
3. partOfSpeech 必须是常见的简写，如 n., v., adj., adv., prep., conj. 等。
4. chinese 必须是精准流利的中文释义。
5. definition 是简洁易懂的英文定义（如：Showing great attention to detail; very careful and precise.）。
6. example 是一个非常高质量、学术性强的雅思水平例句。${moduleTargetDesc}
7. exampleTranslation 是对该例句的精准流畅翻译。
8. ${moduleEnforcement}
9. topic 是该单词所属的微观话题分类，如 'Science & Tech', 'Education', 'Environment', 'Psychology', 'General' 等。
10. allMeanings 必须包含该单词的全部主要释义和不同词性列表。每个含义有 partOfSpeech (词性，如 n., v. 等), chinese (中文释义), definition (简明英文定义)。
11. collocations 必须包含3-4个在雅思考试中非常常用且地道的词组搭配/固定搭配/常用短语。每个搭配有 phrase (词组英文), translation (词组中文翻译), example (该词组的简短例句/短语示例，帮助考生掌握用法)。

请按照以下JSON格式返回，不要包含任何 markdown 代码块，直接返回纯JSON：
{
  "word": "单词原形或标准拼写",
  "phonetic": "音标",
  "partOfSpeech": "主词性",
  "chinese": "主中文释义",
  "definition": "主英文定义",
  "example": "雅思例句",
  "exampleTranslation": "例句翻译",
  "category": "reading 或 writing 或 speaking 或 listening",
  "topic": "微观话题分类",
  "allMeanings": [
    {
      "partOfSpeech": "词性1",
      "chinese": "对应释义1",
      "definition": "对应英文定义1"
    }
  ],
  "collocations": [
    {
      "phrase": "词组/搭配1",
      "translation": "词组中文翻译1",
      "example": "搭配简短例句或实例1"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            phonetic: { type: Type.STRING },
            partOfSpeech: { type: Type.STRING },
            chinese: { type: Type.STRING },
            definition: { type: Type.STRING },
            example: { type: Type.STRING },
            exampleTranslation: { type: Type.STRING },
            category: { type: Type.STRING },
            topic: { type: Type.STRING },
            allMeanings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  partOfSpeech: { type: Type.STRING },
                  chinese: { type: Type.STRING },
                  definition: { type: Type.STRING }
                },
                required: ['partOfSpeech', 'chinese']
              }
            },
            collocations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  phrase: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ['phrase', 'translation']
              }
            }
          },
          required: ['word', 'phonetic', 'partOfSpeech', 'chinese', 'definition', 'example', 'exampleTranslation', 'category', 'topic', 'allMeanings', 'collocations']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error in word lookup:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to retrieve word information' });
  }
});

// 1. Generate Mnemonics (AI助记法)
app.post('/api/gemini/mnemonic', async (req, res) => {
  try {
    const { word, definition, partOfSpeech, chinese } = req.body;
    if (!word) {
      return res.status(400).json({ error: 'Word is required' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个天才英语词汇教师，擅长通过各种有趣的技巧帮助学生轻松记住高难度雅思词汇。
请针对以下单词设计一套生动、容易记忆的“AI助记卡片”：
单词: "${word}"
词性: "${partOfSpeech || ''}"
中文释义: "${chinese || ''}"
英文定义: "${definition || ''}"

请按照以下JSON格式返回，不要包含任何 markdown 代码块（如 \`\`\`json ），直接返回纯JSON字符串：
{
  "etymology": "词源或词根词缀解析（例如：mitigate 源自拉丁语 mitigare...，miti-表示温和）",
  "association": "谐音联想、趣味故事、或生活场景联想，帮助大脑建立第一视觉记忆",
  "trick": "一句话神级口诀或超凡记忆法（非常精炼易记）",
  "synonyms": ["同义词1", "同义词2", "同义词3"],
  "collocations": ["高频搭配1", "高频搭配2", "高频搭配3"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            etymology: { type: Type.STRING },
            association: { type: Type.STRING },
            trick: { type: Type.STRING },
            synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
            collocations: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['etymology', 'association', 'trick', 'synonyms', 'collocations']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating mnemonic:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to generate mnemonic helper' });
  }
});

// 2. Generate IELTS Writing Task 2 Context (雅思写作高分段落)
app.post('/api/gemini/writing', async (req, res) => {
  try {
    const { words } = req.body; // Array of strings
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'An array of words is required' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个雅思写作官方考官（IELTS Writing Examiner）。
请就一个常见的雅思写作议论文（Task 2）话题，写一个高分学术段落（符合Band 8.5+标准）。
要求：
1. 段落中**必须自然、恰当**地融入以下雅思词汇：[ ${words.join(', ')} ]。
2. 并在段落里将这些词汇用 **加粗** (如 **word**) 标出。
3. 提供一个有深度的话题题目、高分示范段落、段落中文翻译，以及针对这些词汇在写作中如何体现学术深度和逻辑连贯性的独家解析。

请严格按照以下JSON格式返回：
{
  "essayPrompt": "雅思写作Task 2题目（英文，如：Some people think technology has made us more isolated...）",
  "topicName": "话题类别（如：科技与社会、教育公平、环境可持续性等）",
  "paragraph": "英文高分示范段落（段落中要加粗包含的词汇）",
  "translation": "段落的流畅中文翻译",
  "tips": "考官深度解析（说明为什么要这么用这些词，如何拿高分，字数150字左右）"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            essayPrompt: { type: Type.STRING },
            topicName: { type: Type.STRING },
            paragraph: { type: Type.STRING },
            translation: { type: Type.STRING },
            tips: { type: Type.STRING }
          },
          required: ['essayPrompt', 'topicName', 'paragraph', 'translation', 'tips']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating writing task:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to generate IELTS writing context' });
  }
});

// 3. Generate IELTS Speaking Interview (雅思口语实战模拟)
app.post('/api/gemini/speaking', async (req, res) => {
  try {
    const { word } = req.body;
    if (!word) {
      return res.status(400).json({ error: 'Word is required' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个雅思口语考官（IELTS Speaking Examiner）。
请针对雅思口语考试设计一个问题，并给出一个使用了词汇 "${word}" 的 Band 8.0+ 满分口语答案示例。
要求：
1. 确定这道题属于口语考试的哪一个部分（Part 1, Part 2, 还是 Part 3）。
2. 在口语答案中自然地嵌入该词汇，并用加粗 (如 **word**) 形式显示。
3. 提供答案的流畅中文翻译。
4. 提供“高分表达技巧建议”，包括连读、语气重音和口语词伙搭配。

请严格按照以下JSON格式返回：
{
  "part": "雅思口语部分（如：Part 1 - Daily Life / Part 3 - Abstract Discussion）",
  "question": "口语考官问题 (英文)",
  "answer": "考官示范答案 (英文，加粗显示单词)",
  "translation": "答案的中文翻译",
  "coaching": "考官发音与词伙搭配建议（中文，精炼）"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            part: { type: Type.STRING },
            question: { type: Type.STRING },
            answer: { type: Type.STRING },
            translation: { type: Type.STRING },
            coaching: { type: Type.STRING }
          },
          required: ['part', 'question', 'answer', 'translation', 'coaching']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating speaking task:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to generate IELTS speaking context' });
  }
});

// 4. Interactive Vocabulary Chat (AI 专属单词答疑与语境拓展)
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { word, message, history } = req.body;
    if (!word || !message) {
      return res.status(400).json({ error: 'Word and message are required' });
    }

    const ai = await getLLMClientForRequest(req);

    // Reconstruct chat history in Gemini structure
    const chatHistory = (history || []).map((h: any) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }]
    }));

    // Start Chat
    const chat = ai.chats.create({
      model: 'gemini-3.6-flash',
      config: {
        systemInstruction: `你是“雅思词汇记背伴侣”应用中的专属 AI 词汇导师。
你目前正在为学生解答关于单词 "${word}" 的疑问，或者进行该单词的相关用法、语境拓展。
学生发送的信息是关于这个单词的。
请给出生动、精确、鼓励性的解答。回答要重点突出：
- 单词在雅思考试（阅读、听力、写作、口语）中的真实应用倾向和得分点。
- 辨析它和近义词的微妙区别。
- 给出一个全新的、容易在写作中模仿的高分例句。
- 语言风格要亲切专业、条理清晰，使用 Markdown 格式（比如用粗体、列表和引用框）。
- 回答限制在 250 字以内，保持高效！`
      }
    });

    // Send history first if it exists to build context
    if (chatHistory.length > 0) {
      // Setup the internal history of the chat object manually
      // We can also just run standard generateContent with complete conversational context
      // Which is safer and less prone to SDK-specific history sync errors!
    }

    // Let's use standard generateContent with reconstructed conversational context for maximum safety
    const formattedPrompt = chatHistory.length > 0 
      ? `以下是我们的对话历史：\n${chatHistory.map((ch: any) => `${ch.role === 'model' ? 'AI' : '学生'}: ${ch.parts[0].text}`).join('\n')}\n\n当前学生新提出的问题："${message}"\n\n请作为AI词汇导师，针对单词 "${word}" 给出解答：`
      : `学生提出的关于单词 "${word}" 的问题："${message}"\n\n请作为AI词汇导师给出解答：`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: formattedPrompt,
      config: {
        systemInstruction: `你是“雅思词汇记背伴侣”应用中的专属 AI 词汇导师。你正在为学生解答关于单词 "${word}" 的疑问。
请给出生动、精确、鼓励性的解答。回答重点突出：它在雅思考试中的用法、近义词微妙区别、在写作中容易模仿的高分例句。
使用优雅的 Markdown 格式，回答限制在 250 字以内，字斟句酌，保持高含金量。`
      }
    });

    res.json({ reply: response.text });
  } catch (error: any) {
    console.error('Error in vocab coach chat:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to chat with AI Vocabulary Coach' });
  }
});

// Parse PDF, DOCX, or TXT file from base64
app.post('/api/materials/parse-file', async (req, res) => {
  try {
    const { base64, fileName, fileType } = req.body;
    if (!base64) {
      return res.status(400).json({ error: 'Base64 file data is required' });
    }

    const buffer = Buffer.from(base64, 'base64');
    let extractedText = '';

    const lowerName = (fileName || '').toLowerCase();
    
    if (lowerName.endsWith('.pdf') || fileType === 'application/pdf') {
      try {
        const data = await pdf(buffer);
        extractedText = data.text || '';
        // Clean whitespace
        if (!extractedText.trim()) {
          extractedText = '[提示]：该 PDF 未能提取到可读文本。可能是由于该 PDF 是由图片生成的扫描件，或者是受保护/加密的文档。\n\n请尝试直接在此文本框内复制粘贴您的学习材料内容，即可继续使用精读笔记与 AI 高频词伙提炼功能！';
        }
      } catch (pdfErr: any) {
        console.error('Error parsing PDF:', pdfErr);
        extractedText = '[提示]：解析 PDF 文件失败（错误信息：' + pdfErr.message + '）。\n\n这通常是由于 PDF 文件损坏、加密或格式特殊。请不用担心，您可以通过直接将文章内容复制，并在此输入框内粘贴，即可继续使用系统提供的精读和一键 AI 总结服务。';
      }
    } else if (lowerName.endsWith('.docx') || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.doc')) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value || '';
        if (!extractedText.trim()) {
          extractedText = '[提示]：该 Word 文档未能提取到可读文本。请确保文档中含有可读文本，而非仅包含图片。\n\n您也可以直接在这里复制粘贴您的文章段落以开始学习！';
        }
      } catch (docxErr: any) {
        console.error('Error parsing DOCX:', docxErr);
        extractedText = '[提示]：解析 Word 文档失败（错误信息：' + docxErr.message + '）。\n\n请确认该 .docx 格式正确且未加密。您也可以直接在此输入框内复制粘贴文本内容以开始精读。';
      }
    } else {
      // Treat as plain text
      extractedText = buffer.toString('utf-8');
    }

    res.json({ text: extractedText });
  } catch (error: any) {
    console.error('Error in parse-file:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'文件解析失败' });
  }
});

// Parse Excel or CSV file from base64, extract text rows, and use Gemini to intelligently segment and translate
app.post('/api/materials/parse-excel', async (req, res) => {
  try {
    const { base64, fileName, duration } = req.body;
    if (!base64) {
      return res.status(400).json({ error: 'Base64 file data is required' });
    }

    const buffer = Buffer.from(base64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let textLines: string[] = [];

    // Extract raw text cells from all sheets with maximum tolerance and detail preservation
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) || [];
      for (const row of rows) {
        if (!row || !Array.isArray(row)) continue;
        
        // Scan cells, filter out empty cells, convert everything to string representation
        const cellStrings = row
          .map(cell => {
            if (cell === null || cell === undefined) return '';
            const trimmed = String(cell).trim();
            // If it's a numeric index like row count or empty/spacer, keep if it's alphanumeric but omit if single short number
            if (/^\d+$/.test(trimmed) && trimmed.length <= 3) return '';
            return trimmed;
          })
          .filter(Boolean);

        if (cellStrings.length > 0) {
          // Join the cells in this row using " | " to help Gemini understand the columns/fields if they exist
          textLines.push(cellStrings.join(' | '));
        }
      }
    }

    const combinedRawText = textLines.join('\n');
    if (!combinedRawText.trim()) {
      return res.status(400).json({ error: 'Excel/CSV 格式不正确，或无法从中提取到任何有效文本' });
    }

    console.log(`[Parse Excel Paragraphs] Extracted ${textLines.length} rows. Total character length: ${combinedRawText.length}`);

    // Call Gemini to reconstruct, segment into dual-language paragraphs
    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个顶级的雅思听力/口语官方辅导名师，也是极其资深的音视频字幕与双语文章处理专家。
我们从用户上传的一个 Excel/CSV 字幕或对照文稿中提取了以下不规则的原始单元格行数据（因为格式原因，存在断句极度细碎、没有标点、单句碎裂成多行、甚至有些行混杂了不完整段落等极其糟糕的问题）：

【原始提取文本数据（含部分字段及破碎行）】：
"""
${combinedRawText.slice(0, 40000)}
"""

请执行以下任务：
1. 【自动提取与学术级智能段落重组】：
   分析上述内容，剔除多余格式和纯数字干扰。将这些支离破碎的英文文本【智能重组拼接】，彻底整理为逻辑连贯、主谓完整、语义顺畅的【中型学术双语段落（段落大小以 2-4 句话，约 25-50 个单词为宜，绝对不要输出细细碎碎的短句！）】。
2. 【学术级雅思双语对照】：
   如果原表自带翻译，请尝试对齐；若无，请为每个整理出的大气英文学术段落生成严谨、词汇丰富地道的雅思中英对照段落翻译。
3. 【连续不重叠段落时间轴估计】：
   由于字幕被合并重组为优美的大段落，请为整理后的每一个【双语段落】分配合理的、连续不重叠的起止播放时间戳（start 和 end，单位：秒）：
   - 第一段必须从 0.0s 开始。
   - 上一段的结束时间 end 必须完全等于下一段的开始时间 start（无缝衔接）。
   - 总时长控制在约 ${duration || 120} 秒左右。

返回格式必须是标准的 JSON，其中包含 "subtitles" 数组，数组内的对象带有 "id", "start", "end", "text", "translation" 属性。
请确保返回格式完全符合以下规范，切勿输出任何 Markdown 标记：
{
  "subtitles": [
    {
      "id": "excel-p-1",
      "start": 0.0,
      "end": 20.0,
      "text": "Corrected and logically assembled English paragraph paragraph with high cohesive flow.",
      "translation": "对应的雅思精细学术双语中文对照段落翻译。"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subtitles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  translation: { type: Type.STRING }
                },
                required: ['id', 'start', 'end', 'text', 'translation']
              }
            }
          },
          required: ['subtitles']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json({
      success: true,
      rawTextCount: textLines.length,
      subtitles: result?.subtitles || []
    });

  } catch (error: any) {
    console.error('Error parsing excel subtitles to paragraphs:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Excel/CSV 智能分段重构失败' });
  }
});

// AI subtitle alignment and smart sentence reconstruction
app.post('/api/gemini/align-subtitles', async (req, res) => {
  try {
    const { rawText, duration } = req.body;
    if (!rawText) {
      return res.status(400).json({ error: 'Raw text is required' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个顶级的雅思听力/口语教学专家，擅长多媒体字幕与高分学术逐句对齐断句处理。
我们有一段英文视频原稿、听力文本或带有时间轴的原始字幕文本：
"""
${rawText}
"""

请执行以下任务：
1. 【高精度智能逐句断句（Sentence-by-Sentence Segmentation）】：
   - 仔细分析输入的文本。
   - 识别出每一个【完整的英文单句】（以句号、问号、叹号或明确的语义意群为分界线，即逐句断句）。
   - 不要合并为长篇大论的段落，也不要把单个完整句子切得支离破碎（严禁把单行两三个单词切碎成独立项，必须是一个主谓宾语义完整、发音自然的完整单句）。
   - 确保完全覆盖输入文稿中的所有英文内容，不遗漏任何一句话。

2. 【时间轴高精度分配/保留】：
   - 【如果原文本带有时间戳/时间线】：请提取、保留并分配每句话原本的开始时间(start)和结束时间(end)。确保每句时间范围与原文发音同步，严禁凭空乱编或抹除。
   - 【如果原文本完全不带时间轴】：则根据视频设定的总时长（约 ${duration || 120} 秒），按照各句英文单词数占总单词数的比例，在时间轴上【无缝且连续地平滑分配】每句的起止秒数。确保第一句从 0.0s 开始，上一段的结束时间就是下一段的开始时间，最后一段的结束时间贴近总时长。

3. 【雅思学术级逐句对照翻译】：
   - 为每一句英文单独生成严谨、生动、符合雅思听力和影子跟读习惯的学术级中文翻译对照。

🔴🔴🔴 【极其重要：严禁截断，严禁限制数量】 🔴🔴🔴
- 绝对不能只返回几句或截断（严禁只返回 5 个或少量字幕）！
- 无论输入的文本有多长，你都必须对文中的每一句英文、每一条原始字幕进行完整的断句与翻译。
- 确保返回的 "subtitles" 数组包含所有的英文单句。如果有 10 句、20 句、50 句甚至 100 句，你就必须全部处理并返回。绝对不能只处理前 5 句！有多少句就必须返回多少句，直至整篇英文原稿全部对齐断句翻译完成，绝对不能遗漏任何一处。

返回格式必须为标准的 JSON，包含 "subtitles" 数组：
{
  "subtitles": [
    {
      "id": "paste-ai-1",
      "start": 0.0,
      "end": 4.5,
      "text": "The first complete English sentence goes here.",
      "translation": "对应的第一句学术级中文翻译。"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subtitles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  translation: { type: Type.STRING }
                },
                required: ['id', 'start', 'end', 'text', 'translation']
              }
            }
          },
          required: ['subtitles']
        }
      }
    });

    const parsed = safeJSONParse(response.text);
    res.json(parsed);
  } catch (error: any) {
    console.error('Error in align-subtitles:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'AI alignment failed' });
  }
});

// Context-aware translation & Analysis for IELTS Learning
app.post('/api/gemini/translate-context', async (req, res) => {
  try {
    const { text, context, category, name } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Selected text is required' });
    }

    const prompt = `
      你是一个资深的雅思（IELTS）学术英语专家。请翻译并分析以下用户在学习雅思材料时选中的单词、短语或句子。
      
      【待解析内容】：
      "${text}"
      
      【学习材料上下文】：
      "...${context || ''}..."
      
      【材料名称】：${name || '未知雅思材料'}
      【雅思科目模块】：${category ? category.toUpperCase() : 'GENERAL'}
      
      特别任务 (ASR/拼写自动纠错)：
      由于部分材料可能是用户通过语音识别 (STT/ASR) 音译过来、或存在手打拼写错误的文本。请你仔细评估【待解析内容】在当前上下文语境中是否是一个拼写错误或语音识别错误（例如拼写错误、音近词混淆、语法断裂等）。
      - 如果你发现有错误，请在返回的 JSON 中，将 "word" 字段设定为【修正后的正确标准学术英文单词/短语】，且将 "isCorrected" 设为 true，并在 "correctionExplanation" 中写明纠错详情。
      - 如果原文拼写完全正确，则将 "word" 设为原文单词/短语，将 "isCorrected" 设为 false，"correctionExplanation" 设为空字符串。
      
      【语言输出极其重要规则】：
      - 必须保证除 word、phonetic、partOfSpeech 以及 englishDefinition（必须是标准英文定义）外，
      - 其余所有的说明和解析字段，包括 contextualExplanation（学术语境与代指分析）、ieltsTips（雅思备战干货提示）、translation（中文翻译）、correctionExplanation（纠错说明）以及 exampleTranslation（例句翻译），【必须全部严格使用简体中文撰写】，严禁使用英文输出这些字段。
      
      请严格以 JSON 格式返回（不要在外部包裹 \`\`\` 格式），属性格式如下：
      {
        "word": "解析出的正确英文单词或短语（如果原文有拼写或语音识别混淆错误，请输出自动修正后的正确词汇）",
        "isCorrected": true, // 或 false，表示是否进行了纠错
        "correctionExplanation": "如果进行了拼写纠错，请说明原因 and 修正依据（必须用中文）",
        "phonetic": "英式或美式音标 (如果是单词/短语，例如 /maɪˈɡreɪʃn/，否则为空)",
        "partOfSpeech": "词性，例如 n. / v. / adj. (如果是单词/短语，否则为空)",
        "translation": "结合上下文的精准中文翻译",
        "englishDefinition": "该单词或短语的标准简明英文定义 (如: 'to move from one place to another'，请确保这是标准的词典英文定义，而非中文释义或语境指代分析)",
        "contextualExplanation": "结合雅思该语境下的详细用法解析，说明为什么在这里是这个意思，指代什么或者隐含意义（必须用中文）",
        "ieltsTips": "雅思备战干货提示（如：写作推荐用法、口语常用语伙、听力同义替换点、阅读常考释义等，请提供2-3条建议，以段落形式，必须用中文）",
        "example": "基于该语境/雅思考点，再原创一个高质学术雅思考试风格的例句（含对应词性或词伙搭配）",
        "exampleTranslation": "原创学术例句的中文翻译"
      }
    `;

    const ai = await getLLMClientForRequest(req);

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            isCorrected: { type: Type.BOOLEAN },
            correctionExplanation: { type: Type.STRING },
            phonetic: { type: Type.STRING },
            partOfSpeech: { type: Type.STRING },
            translation: { type: Type.STRING },
            englishDefinition: { type: Type.STRING },
            contextualExplanation: { type: Type.STRING },
            ieltsTips: { type: Type.STRING },
            example: { type: Type.STRING },
            exampleTranslation: { type: Type.STRING }
          },
          required: [
            'word',
            'isCorrected',
            'correctionExplanation',
            'phonetic',
            'partOfSpeech',
            'translation',
            'englishDefinition',
            'contextualExplanation',
            'ieltsTips',
            'example',
            'exampleTranslation'
          ]
        }
      }
    });

    let responseText = response.text || '{}';
    res.json(safeJSONParse(responseText));
  } catch (error: any) {
    console.error('Error in translate-context:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'AI 语境翻译失败' });
  }
});

// New: Line-by-line Translation for IELTS materials
app.post('/api/gemini/translate-by-line', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Content is required for line translation' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个顶级雅思（IELTS）学术英语翻译专家。
请将以下学术英语学习材料进行【逐句/逐行对照翻译】。
你要根据上下文语境，提供高度学术、准确且通顺的中文翻译。

请将文章拆解为若干个语义完整的句子。
输出必须是 JSON 格式，包含一个 "lines" 数组，且数组中的每个元素包含英文原句和其中文翻译：

【待翻译材料内容】：
"${content}"

请严格按照以下 JSON Schema 返回：
{
  "lines": [
    {
      "original": "原英文句子",
      "translation": "对应的精准中文翻译"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING },
                  translation: { type: Type.STRING }
                },
                required: ['original', 'translation']
              }
            }
          },
          required: ['lines']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error translating by line:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'逐行翻译失败' });
  }
});

// 5. Summarize Material (文档 & 链接 AI 学习总结与要点提炼)
app.post('/api/gemini/summarize-material', async (req, res) => {
  try {
    const { name, type, content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Content is required for summarization' });
    }

    const ai = await getLLMClientForRequest(req);
    const prompt = `你是一个顶级雅思学术辅导名师。请针对以下上传的雅思学习材料进行深度分析：
材料名称: "${name || '未命名材料'}"
材料类型: "${type || 'document'}"
材料内容: 
"${content}"

请提取出这份材料中需要记忆的：
1. 核心高分学术词汇（3-5个，提供单词、词性、中文、英文定义、以及材料中或全新的例句）
2. 核心语法句式结构（1-3个，提供句型、语法讲解、以及例句）
3. 高频词伙搭配（5个左右）
4. 全文核心要点总结（一小段话，概括主旨和备考意义）

请严格按照以下JSON格式返回，不要包含任何 markdown 代码块，直接返回纯 JSON：
{
  "summary": "全文核心要点总结（中文，100字以内，重点突出备考启发）",
  "keyVocabulary": [
    {
      "word": "单词",
      "partOfSpeech": "词性(如 n.)",
      "chinese": "中文释义",
      "definition": "英文定义",
      "example": "例句"
    }
  ],
  "grammarPoints": [
    {
      "point": "句型结构（如 Not only... but also...）",
      "explanation": "语法讲解（中文，简明扼要）",
      "example": "例句（英文）"
    }
  ],
  "collocations": ["高频搭配1 (e.g. key role)", "高频搭配2", "高频搭配3"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            keyVocabulary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING },
                  partOfSpeech: { type: Type.STRING },
                  chinese: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ['word', 'partOfSpeech', 'chinese', 'definition', 'example']
              }
            },
            grammarPoints: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  point: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ['point', 'explanation', 'example']
              }
            },
            collocations: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['summary', 'keyVocabulary', 'grammarPoints', 'collocations']
        }
      }
    });

    const result = safeJSONParse(response.text);
    res.json(result);
  } catch (error: any) {
    console.error('Error summarizing material:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to generate learning summary' });
  }
});

// 6. Transcribe Audio (音频逐句转写，支持听力逐字听写)
app.post('/api/gemini/transcribe-audio', async (req, res) => {
  try {
    let { audioData, mimeType, sampleName } = req.body;
    
    // If we have actual audio data, we can transcribe it using Gemini
    if (audioData) {
      if (!mimeType) {
        mimeType = 'audio/mp3';
      }
      
      // Clean up common non-standard mime types
      if (mimeType.includes('x-m4a')) {
        mimeType = 'audio/m4a';
      } else if (mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3')) {
        mimeType = 'audio/mp3';
      }
      
      const ai = await getLLMClientForRequest(req);
      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioData
            }
          },
          {
            text: `You are an expert IELTS Listening examiner. Your task is to transcribe this audio perfectly for student dictation.
Please provide a high-precision transcript, segment it into a list of natural sequential sentences for dictation, and provide a natural Chinese translation for each sentence. Also extract 2-3 key vocabulary words that appear in the audio.

Return your response strictly in the following JSON format without any markdown wrappers or code blocks:
{
  "transcript": "Full clean English transcript...",
  "sentences": [
    {
      "original": "Sentence 1 English...",
      "translation": "句子 1 的中文翻译..."
    },
    {
      "original": "Sentence 2 English...",
      "translation": "句子 2 的中文翻译..."
    }
  ],
  "vocab": [
    { "word": "word", "partOfSpeech": "n.", "chinese": "中文意思", "definition": "English definition", "example": "Original IELTS style example sentence" }
  ]
}`
          }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });
      const parsed = safeJSONParse(response.text);
      return res.json(parsed);
    }

    // Otherwise, handle the fallback simulated data
    const simulatedData: Record<string, any> = {
      "Default IELTS Listening Part 1": {
        transcript: "Welcome to the IELTS Academic Listening practice. Today, we will discuss the implications of renewable energy sources in modern urban architecture. Many cities are struggling to implement solar panels on historical buildings due to strict visual regulations.",
        sentences: [
          "Welcome to the IELTS Academic Listening practice.",
          "Today, we will discuss the implications of renewable energy sources in modern urban architecture.",
          "Many cities are struggling to implement solar panels on historical buildings due to strict visual regulations."
        ],
        vocab: [
          { word: "implication", partOfSpeech: "n.", chinese: "影响，含义", definition: "The conclusion that can be drawn from something although it is not explicitly stated.", example: "The study has major implications for future education policies." },
          { word: "implement", partOfSpeech: "v.", chinese: "实施，执行", definition: "Put a decision, plan, or agreement into effect.", example: "The government has agreed to implement the recommendations." },
          { word: "regulation", partOfSpeech: "n.", chinese: "条例，规定", definition: "A rule or directive made and maintained by an authority.", example: "New safety regulations have been introduced." }
        ]
      }
    };

    const key = sampleName || "Default IELTS Listening Part 1";
    const result = simulatedData[key] || simulatedData["Default IELTS Listening Part 1"];
    res.json(result);
  } catch (error: any) {
    console.error('Error transcribing audio:', error);
    res.status(error.code === 'LLM_NOT_CONFIGURED' ? 403 : 500).json({ error: error.message ||'Failed to transcribe audio' });
  }
});

// Helper to extract clean plain text from webpage HTML
function stripHtml(html: string): string {
  if (!html) return '';
  // Remove head, script, style, iframe, noscript, footer, nav
  let cleaned = html.replace(/<(head|script|style|iframe|noscript|footer|nav)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Replace HTML tags with spaces
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  cleaned = cleaned.replace(/&nbsp;/g, ' ')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&amp;/g, '&')
                   .replace(/&quot;/g, '"')
                   .replace(/&#39;/g, "'")
                   .replace(/&ldquo;/g, '“')
                   .replace(/&rdquo;/g, '”')
                   .replace(/&middot;/g, '·');
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 4000); // Take first 4000 chars as context
}

// Helper to convert general video webpage URLs to direct embed players (YouTube, Bilibili, etc.)
function getEmbedUrlFromUrl(url: string): string {
  if (!url) return '';
  const lowercaseUrl = url.toLowerCase();
  
  // 1. YouTube
  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) {
    let videoId = '';
    if (lowercaseUrl.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split(/[?#]/)[0] || '';
    } else if (lowercaseUrl.includes('v=')) {
      videoId = url.split('v=')[1]?.split('&')[0] || '';
    } else if (lowercaseUrl.includes('embed/')) {
      videoId = url.split('embed/')[1]?.split(/[?#]/)[0] || '';
    }
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  }
  
  // 2. Bilibili
  if (lowercaseUrl.includes('bilibili.com')) {
    const bvMatch = url.match(/BV[a-zA-Z0-9]{10}/i);
    if (bvMatch) {
      return `https://player.bilibili.com/player.html?bvid=${bvMatch[0]}&high_quality=1&danmaku=0&autoplay=0`;
    }
    const aidMatch = url.match(/av\d+/i);
    if (aidMatch) {
      return `https://player.bilibili.com/player.html?aid=${aidMatch[0].replace('av', '')}&high_quality=1&danmaku=0&autoplay=0`;
    }
  }
  
  // 3. TED Talks
  if (lowercaseUrl.includes('ted.com/talks/')) {
    return url.replace('ted.com/talks/', 'embed.ted.com/talks/');
  }

  // 4. Direct video streams
  if (lowercaseUrl.endsWith('.mp4') || lowercaseUrl.endsWith('.webm') || lowercaseUrl.endsWith('.ogg')) {
    return url;
  }
  
  return url;
}

// New: Crawler for Webpage Videos (Crawl video and bilingual subtitles sentence-by-sentence)
app.post('/api/materials/crawl-video', async (req, res) => {
  const { url, category } = req.body || {};
  try {
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const calculatedVideoUrl = getEmbedUrlFromUrl(url);

    // 1. Scrape real plain text and metadata from webpage if possible
    let scrapedTitle = '';
    let scrapedDescription = '';
    let scrapedContentText = '';
    let isWebpageSuccessfullyScraped = false;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        // SSRF 防护：只允许抓取公网 https 目标，禁止内网/本机/元数据地址
        await assertSafeHttpUrl(url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

        const fetchRes = await fetch(url, {
          redirect: 'manual', // 不跟随重定向，防止跳到内网
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
          }
        });
        clearTimeout(timeoutId);

        if (fetchRes.ok) {
          const html = await fetchRes.text();
          scrapedContentText = stripHtml(html);
          isWebpageSuccessfullyScraped = true;
          
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            scrapedTitle = titleMatch[1].trim();
          }
          
          const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) || 
                            html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
          if (descMatch && descMatch[1]) {
            scrapedDescription = descMatch[1].trim();
          }
        }
      } catch (err) {
        console.warn('Webpage fetch for crawl-video failed or timed out:', err);
      }
    }

    const ai = await getLLMClientForRequest(req);
    
    // Construct prompt. If we scraped content, we provide it to Gemini.
    let prompt = `你是一个资深的雅思听力/口语教学博主，以及网络爬虫提取与内容精炼专家。擅长将热门网页、YouTube、Bilibili等博主的英文VLOG、演讲、纪录片或学术视频进行智能网页解析、内容提取并重构为高价值的雅思英语学习材料。
当前用户提供了一个视频或网页链接: "${url}"，其指定的雅思科目分类为: "${category || 'listening'}"。

请务必先通过谷歌搜索工具查找关于该链接/视频（如 Bilibili 视频号、BV 号、YouTube ID、或者视频标题/博主名）的真实音频转写文稿、中英字幕或详细内容介绍。
请结合真实的网页与视频内容，智能爬取、提炼并输出一份高度吻合视频实际说话内容、学术与实用性完美交融的英语学习双语对照字幕文稿与雅思考点分析。

要求：
1. 智能生成一个富有吸引力的雅思学术VLOG或双语课程标题（如：【跟学姐沉浸式备考】用顶级词伙开启 productive 的一天、或者【学术博主日常】如何用地道表达跟导师讨论 Research Hypothesis 等）。
2. 提供一段完整的视频大纲/核心概要（中文，100字左右，强调视频中的雅思口语/听力考点）。
3. 智能提炼、还原或转写出该视频前 1 到 2 分钟内（或全视频，如果较短）的【8 到 15 句】高质量、高度还原视频原声、连贯的、符合母语英语博主口吻的字幕段落（总长约 150-250 词）。文稿中应自然、巧妙地融入 3 个以上高频雅思核心高分词汇（例如: ubiquitous, meticulous, alleviate, scrutinise, paradigm, advocate 等，并确保有难度、地道）。
4. 【极其重要】提供完全吻合视频实际播放、且完全对齐英文句子发音起止的逐句时间轴信息 (Timeline)。每句话都必须有 "start" (开始秒数，可带小数) 和 "end" (结束秒数，可带小数)。起止时间必须连续且完全合理，不能重合，且累计总长必须覆盖 60 到 120 秒以上（例如第一句 0.0 - 5.5，第二句 5.5 - 12.0，依次递增直到最后一秒），以使得跟读与精听功能可以完美对齐视频。
5. 提供每句英文最地道、精准的中文对照翻译。
6. 精准提炼出这 3 个核心雅思高分学术单词，提供词性、中文、英文定义和雅思原创学术例句。

请严格按照以下 JSON Schema 返回结果：
{
  "title": "视频VLOG标题（中文或中英混合）",
  "summary": "视频概要/博主背景介绍（中文，强调视频中的雅思考点，100字以内）",
  "videoUrl": "建议使用的网页视频源（如果是直接视频地址请保留；如果是Bilibili/YouTube我们会自动转换；如果是常规网页，请建议一个高清学术或备考相关的MP4链接）",
  "transcript": "完整的英文视频文稿内容",
  "subtitles": [
    {
      "id": "s1",
      "start": 0.0,
      "end": 5.5,
      "text": "Hey everyone, welcome back to my weekly study vlog!",
      "translation": "嘿大家，欢迎回到我的每周学习视频！"
    }
  ],
  "vocab": [
    {
      "word": "单词",
      "partOfSpeech": "词性(如 v. / adj.)",
      "chinese": "中文释义",
      "definition": "简要英文定义",
      "example": "学术例句"
    }
  ]
}
`;

    if (isWebpageSuccessfullyScraped) {
      prompt += `

【检测到网页爬取成功】以下是爬取到的真实网页文本内容和标题，请务必围绕这个真实主题或内容，提炼出完美的双语字幕段落与词汇！
网页标题 (Scraped Title): "${scrapedTitle || 'None'}"
网页描述 (Scraped Meta Description): "${scrapedDescription || 'None'}"
网页文本片段 (Scraped Text Snippet):
"""
${scrapedContentText}
"""
`;
    }

    // Try YouTube direct subtitle fetch first if url is a YouTube link
    const videoIdForDirect = extractYoutubeVideoId(url);
    if (videoIdForDirect) {
      try {
        console.log(`[Crawl Video] Detected YouTube URL. Attempting direct CC subtitle extraction for video ID: ${videoIdForDirect}`);
        const captionBaseUrl = await fetchYoutubeCaptionUrl(videoIdForDirect);
        if (captionBaseUrl) {
          const captionJsonUrl = `${captionBaseUrl}${captionBaseUrl.includes('?') ? '&' : '?'}fmt=json`;
          const captionRes = await fetch(captionJsonUrl);
          if (captionRes.ok) {
            const captionJson = await captionRes.json();
            const events = captionJson.events || [];
            const directSubtitles: any[] = [];
            let idCounter = 1;

            for (const event of events) {
              if (!event.segs || event.segs.length === 0) continue;
              const text = event.segs.map((s: any) => s.utf8).join('').replace(/\s+/g, ' ').trim();
              if (!text || text.toLowerCase() === '[music]' || text.toLowerCase() === 'music') continue;

              const startMs = event.tStartMs || 0;
              const durationMs = event.dDurationMs || 0;
              directSubtitles.push({
                id: `yt-${idCounter++}`,
                start: parseFloat((startMs / 1000).toFixed(2)),
                end: parseFloat(((startMs + durationMs) / 1000).toFixed(2)),
                text,
                translation: ''
              });
            }

            if (directSubtitles.length > 0) {
              console.log(`[Crawl Video] Successfully extracted ${directSubtitles.length} direct subtitles. Running Gemini to generate IELTS study material based on real transcript...`);
              const truncatedSubtitles = directSubtitles.slice(0, 150); // take first 150 sentences to keep prompt context focused
              const fullTranscriptText = truncatedSubtitles.map(s => s.text).join(' ');

              // Ask Gemini to translate the real subtitles and generate study assets (title, summary, vocab)
              const directPrompt = `你是一个资深的雅思听力/口语教学博主，以及大语言模型智能内容提炼专家。
我们有一段从真实 YouTube 视频中提取的英文 CC 字幕文稿，内容如下：
"""
${fullTranscriptText}
"""

请执行以下任务：
1. 智能生成一个富有吸引力的雅思双语备考标题（中文或中英混合，如：【跟学姐沉浸式备考】用顶级词伙开启 productive 的一天）。
2. 提供一段完整的视频大纲/核心概要（中文，100字左右，强调视频中的雅思口语/听力考点）。
3. 智能翻译以下字幕，为每条字幕生成对应的中文翻译：
${JSON.stringify(truncatedSubtitles.map(s => ({ id: s.id, text: s.text })))}
4. 从英文文稿中提炼 3 个高频核心雅思高分学术单词，提供词性、中文、英文定义和雅思原创学术例句。

请严格按照以下 JSON Schema 返回结果：
{
  "title": "视频VLOG标题",
  "summary": "视频概要/博主背景介绍（100字以内）",
  "vocab": [
    {
      "word": "单词",
      "partOfSpeech": "词性",
      "chinese": "中文释义",
      "definition": "英文简要定义",
      "example": "学术例句"
    }
  ],
  "translations": [
    { "id": "yt-1", "translation": "高水准中文翻译" }
  ]
}
`;

              const directResponse = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: directPrompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      vocab: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            word: { type: Type.STRING },
                            partOfSpeech: { type: Type.STRING },
                            chinese: { type: Type.STRING },
                            definition: { type: Type.STRING },
                            example: { type: Type.STRING }
                          },
                          required: ['word', 'partOfSpeech', 'chinese', 'definition', 'example']
                        }
                      },
                      translations: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            id: { type: Type.STRING },
                            translation: { type: Type.STRING }
                          },
                          required: ['id', 'translation']
                        }
                      }
                    },
                    required: ['title', 'summary', 'vocab', 'translations']
                  }
                }
              });

              const parsedDirect = safeJSONParse(directResponse.text);
              const translationMap = new Map();
              if (parsedDirect && Array.isArray(parsedDirect.translations)) {
                parsedDirect.translations.forEach((t: any) => {
                  translationMap.set(t.id, t.translation);
                });
              }

              const alignedSubtitles = truncatedSubtitles.map(s => ({
                ...s,
                translation: translationMap.get(s.id) || '（暂无中文翻译）'
              }));

              return res.json({
                title: parsedDirect.title || '【YouTube CC】精学材料',
                summary: parsedDirect.summary || '基于 YouTube 官方 CC 提取并提炼的雅思双语材料。',
                videoUrl: calculatedVideoUrl || url,
                transcript: fullTranscriptText,
                subtitles: alignedSubtitles,
                vocab: parsedDirect.vocab || []
              });
            }
          }
        }
      } catch (err: any) {
        console.warn('[Crawl Video] Direct CC flow failed or got blocked. Falling back to Google Search scraper...', err.message);
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        tools: [{ googleSearch: {} }],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            videoUrl: { type: Type.STRING },
            transcript: { type: Type.STRING },
            subtitles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  translation: { type: Type.STRING }
                },
                required: ['id', 'start', 'end', 'text', 'translation']
              }
            },
            vocab: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING },
                  partOfSpeech: { type: Type.STRING },
                  chinese: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ['word', 'partOfSpeech', 'chinese', 'definition', 'example']
              }
            }
          },
          required: ['title', 'summary', 'videoUrl', 'transcript', 'subtitles', 'vocab']
        }
      }
    });

    const result = safeJSONParse(response.text);

    if (calculatedVideoUrl && (calculatedVideoUrl.includes('embed') || calculatedVideoUrl.includes('player.bilibili') || calculatedVideoUrl.includes('mp4') || calculatedVideoUrl.includes('youtube') || calculatedVideoUrl.includes('bilibili'))) {
      result.videoUrl = calculatedVideoUrl;
    } else if (!result.videoUrl || !result.videoUrl.startsWith('http')) {
      result.videoUrl = "https://assets.mixkit.co/videos/preview/mixkit-studying-at-home-with-a-laptop-42352-large.mp4";
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error crawling video webpage:', error);
    const calculatedVideoUrl = getEmbedUrlFromUrl(url);
    res.json({
      title: "【沉浸式备考VLOG】牛津学姐的 productive 一天 | 学术核心词伙跟读",
      summary: "一位英语博主分享自己在大学图书馆沉浸式学习雅思学术英语的一天。视频中自然运用了高难度的学术词汇与短语搭配，是听力和口语跟读的极佳语境素材。",
      videoUrl: calculatedVideoUrl || "https://assets.mixkit.co/videos/preview/mixkit-studying-at-home-with-a-laptop-42352-large.mp4",
      transcript: "Hey everyone, welcome back to my weekly vlog! Today I'm tackling some complex academic articles in the university library. In order to mitigate our study anxiety, we need to implement a meticulous plan. Fostering an empirical approach to IELTS preparation will ultimately help us alleviate pressure and achieve our target scores. Let's study together! In addition, we must scrutinize the literature closely. Gathering relevant data is ubiquitous in scholastic research. We should advocate for stronger methodologies. This dynamic paradigm helps us acquire deep insights and excel in our speaking skills.",
      subtitles: [
        { "id": "s1", "start": 0.0, "end": 4.5, "text": "Hey everyone, welcome back to my weekly vlog!", "translation": "嘿大家，欢迎回到我的每周学习视频！" },
        { "id": "s2", "start": 4.5, "end": 9.5, "text": "Today I'm tackling some complex academic articles in the university library.", "translation": "今天我正在大学图书馆攻读一些复杂的学术文献。" },
        { "id": "s3", "start": 9.5, "end": 14.2, "text": "In order to mitigate our study anxiety, we need to implement a meticulous plan.", "translation": "为了缓解我们的学习焦虑，我们需要执行一个细致周密的计划。" },
        { "id": "s4", "start": 14.2, "end": 20.5, "text": "Fostering an empirical approach to IELTS preparation will ultimately help us alleviate pressure.", "translation": "在雅思备考中培养一种基于实证的方法，最终会帮助我们减轻压力。" },
        { "id": "s5", "start": 20.5, "end": 26.0, "text": "And achieve our target scores. Let's study together!", "translation": "并达到我们的目标分数。让我们一起加油学习吧！" },
        { "id": "s6", "start": 26.0, "end": 31.5, "text": "In addition, we must scrutinize the literature closely and take thorough notes.", "translation": "此外，我们必须仔细审视文献并做好详尽的笔记。" },
        { "id": "s7", "start": 31.5, "end": 37.0, "text": "Gathering relevant academic data is ubiquitous in modern scholastic research.", "translation": "在现代学术研究中，搜集相关的学术数据是无处不在的。" },
        { "id": "s8", "start": 37.0, "end": 42.5, "text": "Therefore, we should advocate for stronger research methodologies to prove our hypothesis.", "translation": "因此，我们应该倡导使用更强大的研究方法来证明我们的假设。" },
        { "id": "s9", "start": 42.5, "end": 48.0, "text": "Adopting this dynamic paradigm will certainly help us acquire deep insights.", "translation": "采用这种动态范式无疑将帮助我们获得深刻的见解。" },
        { "id": "s10", "start": 48.0, "end": 53.5, "text": "And allow us to excel in our academic writing and speaking skills efficiently.", "translation": "并使我们能够高效地在学术写作和口语技能中脱颖而出。" },
        { "id": "s11", "start": 53.5, "end": 58.0, "text": "Consistency and dedication are the key drivers to high-level language fluency.", "translation": "持之以恒和专注是高水平语言流畅度的关键驱动因素。" },
        { "id": "s12", "start": 58.0, "end": 63.5, "text": "Let's stay motivated and continue pushing the boundaries of our intellectual growth.", "translation": "让我们保持动力，继续推动我们智力成长的极限。" }
      ],
      vocab: [
        { "word": "mitigate", "partOfSpeech": "v.", "chinese": "缓解，减轻", "definition": "Make less severe, serious, or painful.", "example": "Meticulous planning can mitigate the challenges of preparation." },
        { "word": "meticulous", "partOfSpeech": "adj.", "chinese": "细致的，一丝不苟的", "definition": "Showing great attention to detail; very careful and precise.", "example": "The researcher carried out a meticulous analysis of the survey data." },
        { "word": "alleviate", "partOfSpeech": "v.", "chinese": "减轻，缓和", "definition": "Make (suffering, deficiency, or a problem) less severe.", "example": "Taking regular study breaks can help alleviate academic stress." }
      ]
    });
  }
});

// Helper function to extract YouTube Video ID from any format of YouTube URL
function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const lowercase = url.toLowerCase();
  if (lowercase.includes('youtu.be/')) {
    return url.split('youtu.be/')[1]?.split(/[?#]/)[0] || null;
  } else if (lowercase.includes('v=')) {
    return url.split('v=')[1]?.split('&')[0] || null;
  } else if (lowercase.includes('embed/')) {
    return url.split('embed/')[1]?.split(/[?#]/)[0] || null;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Highly robust scraper helper to extract caption track baseUrl using multiple direct methods and regex fallback
async function fetchYoutubeCaptionUrl(videoId: string): Promise<string | null> {
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`,
    `https://www.youtube.com/embed/${videoId}`
  ];

  for (const url of urls) {
    try {
      console.log(`[YouTube Captions Scraper] Trying url: ${url}`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/'
        }
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Path A: ytInitialPlayerResponse JSON extraction
      let playerResponseStr = '';
      const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (match) playerResponseStr = match[1];
      else {
        const match2 = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match2) playerResponseStr = match2[1];
        else {
          const match3 = html.match(/"ytInitialPlayerResponse"\s*:\s*({.+?})/);
          if (match3) playerResponseStr = match3[1];
        }
      }

      if (playerResponseStr) {
        try {
          const playerResponse = JSON.parse(playerResponseStr);
          const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captionTracks && Array.isArray(captionTracks) && captionTracks.length > 0) {
            let track = captionTracks.find((t: any) => t.languageCode === 'en' && !t.kind);
            if (!track) track = captionTracks.find((t: any) => t.languageCode === 'en');
            if (!track) track = captionTracks[0];
            if (track && track.baseUrl) {
              console.log(`[YouTube Captions Scraper] Found caption baseUrl in ytInitialPlayerResponse: ${track.baseUrl}`);
              return track.baseUrl;
            }
          }
        } catch (e) {
          console.warn('[YouTube Captions Scraper] Failed to parse playerResponse JSON, continuing to regex fallback...');
        }
      }

      // Path B: Direct regex pattern match on escaped /api/timedtext URLs
      const timedtextRegex = /"https:\\\/\\\/www\.youtube\.com\\\/api\\\/timedtext[^"]+"/g;
      const timedtextMatches = html.match(timedtextRegex);
      if (timedtextMatches && timedtextMatches.length > 0) {
        for (const matchStr of timedtextMatches) {
          let cleanUrl = matchStr.replace(/"/g, '').replace(/\\\\\//g, '/').replace(/\\/g, '');
          try {
            cleanUrl = JSON.parse(`"${cleanUrl}"`);
          } catch (err) {}
          if (cleanUrl.includes('timedtext')) {
            console.log(`[YouTube Captions Scraper] Found caption URL via escaped regex match: ${cleanUrl}`);
            return cleanUrl;
          }
        }
      }

      // Path C: Direct regex pattern match on unescaped timedtext URLs
      const timedtextRegexUnescaped = /https:\/\/www\.youtube\.com\/api\/timedtext[^"'\s>]+/g;
      const unescapedMatches = html.match(timedtextRegexUnescaped);
      if (unescapedMatches && unescapedMatches.length > 0) {
        console.log(`[YouTube Captions Scraper] Found caption URL via unescaped regex match: ${unescapedMatches[0]}`);
        return unescapedMatches[0];
      }

    } catch (err: any) {
      console.warn(`[YouTube Captions Scraper] Error fetching/parsing captions from ${url}:`, err.message);
    }
  }

  return null;
}

// Extract & Translate YouTube CC Subtitles Endpoint
app.post('/api/youtube/subtitles', async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Not a valid YouTube video URL or ID' });
  }

  console.log(`Attempting to extract CC subtitles for YouTube Video ID: ${videoId}`);

  try {
    const captionBaseUrl = await fetchYoutubeCaptionUrl(videoId);
    if (!captionBaseUrl) {
      throw new Error('No caption track URL could be resolved directly from watch page or embed source. Subtitles may be disabled or restricted.');
    }

    // Append fmt=json to retrieve the subtitle track in clean YouTube JSON timing format
    const captionJsonUrl = `${captionBaseUrl}${captionBaseUrl.includes('?') ? '&' : '?'}fmt=json`;
    const captionRes = await fetch(captionJsonUrl);
    if (!captionRes.ok) {
      throw new Error(`Failed to download caption track: HTTP ${captionRes.status}`);
    }

    const captionJson = await captionRes.json();
    const events = captionJson.events || [];

    const subtitles: any[] = [];
    let idCounter = 1;

    for (const event of events) {
      if (!event.segs || event.segs.length === 0) continue;
      const text = event.segs.map((s: any) => s.utf8).join('').replace(/\s+/g, ' ').trim();
      
      // Filter out empty lines, system noises or mere music tags
      if (!text || text.toLowerCase() === '[music]' || text.toLowerCase() === 'music') continue;

      const startMs = event.tStartMs || 0;
      const durationMs = event.dDurationMs || 0;
      const start = parseFloat((startMs / 1000).toFixed(2));
      const end = parseFloat(((startMs + durationMs) / 1000).toFixed(2));

      subtitles.push({
        id: `yt-${idCounter++}`,
        start,
        end,
        text,
        translation: ''
      });
    }

    if (subtitles.length === 0) {
      throw new Error('Could not parse any subtitles from the video caption track.');
    }

    // Safety limit of 400 items to fit within standard model contexts comfortably
    const processedSubtitles = subtitles.slice(0, 400);

    // AI Translation of the extracted English sentences in a single clean JSON Schema pass
    const ai = await getLLMClientForRequest(req);
    const translationPrompt = `你是一个资深的雅思听力与口语培训专家。
请将下面来自视频CC字幕的英文句子，翻译成非常雅思地道、优美且忠于语境的中文对照。
原文字幕 JSON 数据：
${JSON.stringify(processedSubtitles.map(s => ({ id: s.id, text: s.text })))}

要求：
1. 必须保留原有的 "id"。
2. 返回格式必须为标准的 JSON 格式，包含 "translations" 数组，且其内项为带有 "id" 和 "translation" 属性的对象。不要包含任何 markdown 或外层包装，直接返回 JSON 对象。

JSON Schema 结构：
{
  "translations": [
    { "id": "yt-1", "translation": "高水准中文翻译" }
  ]
}
`;

    const translationResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: translationPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  translation: { type: Type.STRING }
                },
                required: ['id', 'translation']
              }
            }
          },
          required: ['translations']
        }
      }
    });

    const parsedData = safeJSONParse(translationResponse.text);
    const transMap = new Map();
    if (parsedData && Array.isArray(parsedData.translations)) {
      parsedData.translations.forEach((t: any) => {
        transMap.set(t.id, t.translation);
      });
    }

    const finalSubtitles = processedSubtitles.map(s => ({
      ...s,
      translation: transMap.get(s.id) || '（暂无中文翻译，可点击手动编辑）'
    }));

    res.json({
      success: true,
      subtitles: finalSubtitles,
      source: 'YouTube 官方CC字幕'
    });

  } catch (error: any) {
    console.warn(`Direct YouTube CC extraction failed, running Google Search-grounded AI fallback generator... Reason: ${error.message}`);
    try {
      // 1. Fetch title & author from YouTube public oEmbed API which is never blocked
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const oembedRes = await fetch(oembedUrl);
      let videoTitle = 'YouTube Study Video';
      let author = 'YouTube Creator';

      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        videoTitle = oembedData.title || videoTitle;
        author = oembedData.author_name || author;
      }

      console.log(`Fetched video title via oEmbed: "${videoTitle}" by "${author}". Starting Google Search-grounded AI generator...`);

      // 2. Call Gemini-3.5-Flash with search grounding enabled to search for the real transcript / content
      const ai = await getLLMClientForRequest(req);
      const prompt = `你是一个资深的雅思听力与口语辅导专家。
我们正在为一部主题为 "${videoTitle}"（作者: ${author}，YouTube ID为 ${videoId}）的 YouTube 视频，定制设计一版【15句左右】的高质量雅思双语学术对照字幕，供学生进行精听默写和跟读练习。

【至关重要】为了保证跟视频的实际内容高度吻合，你必须使用 Google Search 搜索工具，搜索该视频的真实台词、内容摘要、Transcript 或 spoken content：
1. 优先采用搜索到的该视频实际的英文台词/文字稿进行时间轴和句子的切分，保证完全对应上视频实际内容！
2. 将搜索到的真实文稿切分成【12到18个】发音连贯的单句，为每句生成对应的开始与结束时间轴（即使是合理估算的时间轴，但也必须保证每句文稿就是真实的视频说话内容！）：
   - 第一句从 0.0s 开始。时间轴必须连续递增且不重合。
   - 总时长约在 60 到 90 秒之间。
3. 为每一句配备极其地道、学术词汇对齐的专业中文翻译。
4. 只有当你通过 Google Search 完全查不到任何视频相关文稿或原声台词时，才允许基于视频主题 "${videoTitle}" 的背景自主创作一段极其真实贴近该主题的连贯独白。

必须返回标准的 JSON 格式，不要包含任何 markdown 符号或外层包装。

JSON 结构规范：
{
  "subtitles": [
    {
      "id": "yt-ai-1",
      "start": 0.0,
      "end": 5.4,
      "text": "Hello and welcome to today's academic seminar where we will explore the critical aspects of this subject.",
      "translation": "你好，欢迎来到今天的学术研讨会，在这里我们将探讨这一学科的关键方面。"
    }
  ]
}
`;

      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          tools: [{ googleSearch: {} }],
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subtitles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    translation: { type: Type.STRING }
                  },
                  required: ['id', 'start', 'end', 'text', 'translation']
                }
              }
            },
            required: ['subtitles']
          }
        }
      });

      const parsedFallback = safeJSONParse(fallbackResponse.text);
      if (parsedFallback && Array.isArray(parsedFallback.subtitles) && parsedFallback.subtitles.length > 0) {
        console.log(`Successfully generated AI Google Search grounded fallback subtitles for "${videoTitle}"`);
        return res.json({
          success: true,
          subtitles: parsedFallback.subtitles,
          source: `AI 搜索提炼真实字幕 (${videoTitle})`
        });
      } else {
        throw new Error('Failed to parse AI-generated study subtitles.');
      }

    } catch (fallbackError: any) {
      console.error('YouTube CC extraction and AI Fallback both failed:', fallbackError);
      res.status(500).json({
        error: `提取/抓取 YouTube CC 字幕失败: ${error.message}\n同时 AI 智能合成备用文稿失败: ${fallbackError.message}`
      });
    }
  }
});

// ----------------- VITE & STATIC SERVING -----------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware mounted in Development mode');
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving static files from /dist in Production mode');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IELTS Vocab Backend Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
