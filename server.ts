/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createWriteStream } from 'node:fs';
import { unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { Type } from '@google/genai';
import { installUserSystem } from './server/lib/routes';
import { getASRConfigForUser, getLLMClientForRequest } from './server/lib/llm';
import { assertSafeHttpUrl } from './server/lib/net';
import { downloadYoutubeAudio, youtubeVideoId } from './server/lib/youtubeAudio';
import { splitAudio, parallelTranscribe, type ASRResult } from './server/lib/parallelAsr';
import { transcribeQwenFile } from './server/lib/qwenAsr';
import { cleanAsrSubtitleCues, refineAsrSubtitles } from './server/lib/subtitleRefinement';
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

type TranscriptionJob = {
  ownerId: number;
  status: 'processing' | 'completed' | 'failed';
  message: string;
  result?: { transcript: string; warning?: string; subtitles: { id: string; start: number; end: number; text: string; translation: string }[] };
  error?: string;
  updatedAt: number;
};
const transcriptionJobs = new Map<string, TranscriptionJob>();
const activeASRUploads = new Set<number>();
const temporaryMedia = new Map<string, { path: string; mimeType: string }>();

app.get('/api/asr/media/:token', (req, res) => {
  const media = temporaryMedia.get(req.params.token);
  if (!media) return res.status(404).end();
  res.set({ 'Content-Type': media.mimeType, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(media.path, (error) => { if (error && !res.headersSent) res.status(404).end(); });
});

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
   - 只调整断句和标点，必须逐词保留英文原文，禁止改写、增删、纠错或改变单词顺序。
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

function transcriptionOrigin(req: express.Request): string {
  const origin = new URL(req.header('origin') || '');
  if (origin.host !== req.header('host') || origin.protocol !== 'https:') {
    throw new Error('请通过网站的 HTTPS 地址打开页面后重试，百炼需要公开可访问的音频地址。');
  }
  return origin.origin;
}

app.post('/api/asr/transcribe-youtube', (req, res) => {
  const ownerId = (req as any).userId as number;
  const config = getASRConfigForUser(ownerId);
  if (!config) return res.status(403).json({ error: '请先在「账号与设置 → 语音识别」配置百炼 API Key。' });
  let id: string;
  let origin: string;
  try {
    id = youtubeVideoId(String(req.body?.url || ''));
    origin = transcriptionOrigin(req);
  } catch (error: any) { return res.status(400).json({ error: error.message || '视频链接或网站地址无效。' }); }
  if (activeASRUploads.has(ownerId) || [...transcriptionJobs.values()].some(job => job.ownerId === ownerId && job.status === 'processing')) {
    return res.status(409).json({ error: '已有转写任务正在处理，请等待完成后再试。' });
  }
  if (activeASRUploads.size + [...transcriptionJobs.values()].filter(job => job.status === 'processing').length >= 2) {
    return res.status(429).json({ error: '服务器正在处理其他音视频，请稍后再试。' });
  }
  const jobId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const job: TranscriptionJob = { ownerId, status: 'processing', message: '正在获取 YouTube 音轨…', updatedAt: Date.now() };
  transcriptionJobs.set(jobId, job);
  res.status(202).json({ jobId });
  void (async () => {
    let directory = '';
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'ielts-youtube-'));
      const media = await downloadYoutubeAudio(id, directory);
      temporaryMedia.set(token, media);
      job.message = '音轨已获取，正在提交百炼识别…';
      await runAlibabaTranscription(jobId, token, origin, config, req);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message || '视频语音识别失败，请重试。';
      job.updatedAt = Date.now();
    } finally {
      temporaryMedia.delete(token);
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      setTimeout(() => transcriptionJobs.delete(jobId), 10 * 60 * 1000).unref();
    }
  })();
});

// Upload media to a private temporary file, then submit an async Alibaba Cloud Qwen ASR task.
app.post('/api/asr/transcribe-media', async (req, res) => {
  if (!['standard', 'parallel', 'benchmark'].includes(req.header('x-asr-mode') || 'standard')) return res.status(400).json({ error: '识别模式无效。' });
  const maxBytes = 200 * 1024 * 1024;
  const mimeType = String(req.header('x-media-mime-type') || '').toLowerCase().split(';')[0].trim();
  const allowedMimeTypes = new Set([
    'audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
    'video/3gpp', 'video/avi', 'video/mov', 'video/mp4', 'video/mpeg', 'video/mpg', 'video/webm', 'video/wmv', 'video/x-flv',
  ]);
  if (!allowedMimeTypes.has(mimeType)) return res.status(400).json({ error: '文件格式不支持，请使用 MP3、M4A、WAV、MP4、MOV、AVI 或 WebM。' });
  if (Number(req.header('content-length') || 0) > maxBytes) return res.status(413).json({ error: '文件超过 200 MB，请剪出需要精听的片段后重试。' });

  const ownerId = (req as any).userId as number;
  const config = getASRConfigForUser(ownerId);
  if (!config) return res.status(403).json({ error: '请先到右上角「账号与设置 → 语音识别」配置阿里云百炼 API Key。' });
  const origin = req.header('origin');
  const host = req.header('host');
  let publicOrigin = '';
  try {
    const parsedOrigin = new URL(origin || '');
    if (!host || parsedOrigin.host !== host || (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')) throw new Error();
    publicOrigin = parsedOrigin.origin;
  } catch {
    return res.status(400).json({ error: '无法确认网站公开地址；请从网站页面重新上传，确保浏览器允许发送来源信息。' });
  }

  const extensionByMime: Record<string, string> = {
    'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/m4a': '.m4a',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/webm': '.webm',
    'video/3gpp': '.3gp', 'video/avi': '.avi', 'video/mov': '.mov', 'video/mp4': '.mp4', 'video/mpeg': '.mpeg',
    'video/mpg': '.mpg', 'video/webm': '.webm', 'video/wmv': '.wmv', 'video/x-flv': '.flv',
  };
  const temporaryPath = path.join(tmpdir(), `ielts-asr-${randomUUID()}${extensionByMime[mimeType]}`);
  if (activeASRUploads.has(ownerId) || [...transcriptionJobs.values()].some(job => job.ownerId === ownerId && job.status === 'processing')) return res.status(409).json({ error: '已有完整音轨正在识别，请等待完成。' });
  if (activeASRUploads.size + [...transcriptionJobs.values()].filter(job => job.status === 'processing').length >= 2) return res.status(429).json({ error: '服务器正在处理其他音轨，请稍后再试。' });
  activeASRUploads.add(ownerId);
  try {
    let receivedBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        callback(receivedBytes > maxBytes
          ? Object.assign(new Error('文件超过 200 MB，请剪出需要精听的片段后重试。'), { status: 413 })
          : null, receivedBytes > maxBytes ? undefined : chunk);
      },
    });
    await pipeline(req, sizeGuard, createWriteStream(temporaryPath, { flags: 'wx' }));
    if (!receivedBytes) throw new Error('没有收到文件内容，请重新选择文件。');

    const token = randomBytes(32).toString('hex');
    const jobId = randomUUID();
    temporaryMedia.set(token, { path: temporaryPath, mimeType });
    transcriptionJobs.set(jobId, { ownerId, status: 'processing', message: '正在提交百炼语音识别任务…', updatedAt: Date.now() });
    activeASRUploads.delete(ownerId);
    res.status(202).json({ jobId });

    void runAlibabaTranscription(jobId, token, publicOrigin, config, req).catch((error: any) => {
      console.error('Alibaba ASR task failed:', error);
      const job = transcriptionJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = error?.message || '百炼语音识别失败，请检查 API Key、地域和文件格式后重试。';
        job.updatedAt = Date.now();
      }
    }).finally(async () => {
      temporaryMedia.delete(token);
      await unlink(temporaryPath).catch(() => undefined);
      setTimeout(() => transcriptionJobs.delete(jobId), 10 * 60 * 1000).unref();
    });
  } catch (error: any) {
    activeASRUploads.delete(ownerId);
    await unlink(temporaryPath).catch(() => undefined);
    console.error('Error uploading media for Alibaba ASR:', error);
    return res.status(error.status || 500).json({ error: error.message || '音视频上传失败，请重试。' });
  }
});

app.get('/api/asr/transcribe-media/:jobId', (req, res) => {
  const job = transcriptionJobs.get(req.params.jobId);
  if (!job || job.ownerId !== (req as any).userId) return res.status(404).json({ error: '转写任务不存在或已过期。' });
  res.json({ status: job.status, message: job.message, result: job.result, error: job.error });
});

async function runAlibabaTranscription(
  jobId: string,
  token: string,
  publicOrigin: string,
  config: { region: 'beijing' | 'singapore'; apiKey: string },
  req: express.Request,
) {
  const job = transcriptionJobs.get(jobId)!;
  const mode = req.header('x-asr-mode') || 'standard';
  const totalStarted = Date.now();
  let timingNote = '';
  let result: ASRResult;
  const mediaUrl = `${publicOrigin}/api/asr/media/${token}`;
  const benchmarkStarted = Date.now();
  let baseline: ASRResult | undefined;
  let baselineMs = 0;
  if (mode === 'benchmark') {
    job.message = '耗时对比 1/2：正在整条识别完整音轨…';
    baseline = await transcribeQwenFile(mediaUrl, config);
    baselineMs = Date.now() - benchmarkStarted;
  }
  if (mode === 'parallel' || mode === 'benchmark') {
    const source = temporaryMedia.get(token);
    if (!source) throw new Error('音轨已过期，请重新上传。');
    const directory = await mkdtemp(path.join(tmpdir(), 'ielts-asr-parts-'));
    const partTokens: string[] = [];
    const parallelStarted = Date.now();
    try {
      job.message = '正在切分完整音轨，稍后自动合并全部字幕…';
      const parts = await splitAudio(source.path, directory);
      const splitMs = Date.now() - parallelStarted;
      job.message = `正在并行识别完整音轨：0/${parts.length} 段完成…`;
      result = await parallelTranscribe(parts, async (part) => {
        const partToken = randomBytes(32).toString('hex');
        partTokens.push(partToken);
        temporaryMedia.set(partToken, { path: part.path, mimeType: 'audio/flac' });
        return transcribeQwenFile(`${publicOrigin}/api/asr/media/${partToken}`, config, parallelStarted + 15 * 60 * 1000);
      }, (done, total) => {
        job.message = `正在并行识别完整音轨：${done}/${total} 段完成…`;
        job.updatedAt = Date.now();
      });
      const parallelMs = Date.now() - parallelStarted;
      timingNote = `分段 ${parts.length} 个，最多 3 个同时识别；切分 ${(splitMs / 1000).toFixed(1)} 秒，并行流程共 ${(parallelMs / 1000).toFixed(1)} 秒。`;
      if (baseline) {
        const baselineWords = baseline.transcript.trim().split(/\s+/).length;
        const parallelWords = result.transcript.trim().split(/\s+/).length;
        timingNote = `完整音轨耗时对比：整条识别 ${(baselineMs / 1000).toFixed(1)} 秒；${timingNote}整条/并行输出词数：${baselineWords}/${parallelWords}（需人工校对切分处）。以上不含原音轨下载、上传和中文翻译。`;
      }
    } catch (error: any) {
      if (!baseline) throw error;
      result = baseline;
      timingNote = `并行对比未完成，已保留整条识别的完整结果（${(baselineMs / 1000).toFixed(1)} 秒）。原因：${error?.code === 'ENOENT' ? '服务器缺少音频切分工具' : error?.message || '分段识别失败'}。`;
    } finally {
      for (const partToken of partTokens) temporaryMedia.delete(partToken);
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    job.message = '百炼正在识别完整音视频…';
    result = await transcribeQwenFile(mediaUrl, config);
    timingNote = `英文识别耗时 ${((Date.now() - totalStarted) / 1000).toFixed(1)} 秒（不含下载、上传和中文翻译）。`;
  }
  const { transcript } = result;
  let subtitles = cleanAsrSubtitleCues(result.subtitles);
  if (!subtitles.length) throw new Error('没有识别到清晰语音。请确认音轨中有人声。');
  const translationStarted = Date.now();
  const processingNotes: string[] = [];

  job.message = '百炼识别完成，正在智能整理字幕断句…';
  job.updatedAt = Date.now();
  try {
    const llm = await getLLMClientForRequest(req);
    try {
      subtitles = await refineAsrSubtitles(subtitles, llm, (done, total) => {
        job.message = `正在整理字幕断句：${done}/${total} 批…`;
        job.updatedAt = Date.now();
      });
      if (!subtitles.length) throw new Error('整理后没有可用字幕。');
    } catch (error: any) {
      console.warn('Subtitle grouping skipped; preserving Alibaba ASR cues:', error?.message);
      subtitles = cleanAsrSubtitleCues(result.subtitles);
      processingNotes.push(`AI 字幕整理未完成，已保留百炼原始字幕${error?.message ? `（${error.message}）` : ''}。`);
    }

    job.message = `字幕整理完成，正在生成中文翻译（${subtitles.length} 句）…`;
    job.updatedAt = Date.now();
    const translationDeadline = Date.now() + 3 * 60 * 1000;
    for (let offset = 0; offset < subtitles.length; offset += 40) {
      if (Date.now() >= translationDeadline) break;
      const batch = subtitles.slice(offset, offset + 40);
      job.message = `英文已识别，正在翻译 ${offset + 1}–${offset + batch.length} / ${subtitles.length} 句…`;
      let translationTimer: ReturnType<typeof setTimeout>;
      const translated = await Promise.race([llm.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `Translate each English subtitle into natural, concise Simplified Chinese. Preserve meaning and return only JSON: {"translations":["..."]}. Keep array order and return exactly ${batch.length} translations.\n${JSON.stringify(batch.map((item) => item.text))}`,
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      }), new Promise<never>((_, reject) => {
        translationTimer = setTimeout(() => reject(new Error('翻译等待超时，保留英文字幕。')), 60000);
      })]).finally(() => clearTimeout(translationTimer));
      const parsed = safeJSONParse<any>(translated.text || '{}');
      if (Array.isArray(parsed.translations)) parsed.translations.forEach((text: any, i: number) => {
        if (typeof text === 'string' && batch[i]) batch[i].translation = text.trim();
      });
    }
  } catch (error: any) {
    console.warn('Subtitle translation skipped:', error?.message);
    processingNotes.push(`中文翻译未完成${error?.message ? `（${error.message}）` : ''}。`);
  }
  job.status = 'completed';
  job.message = '转写完成';
  job.result = { transcript: transcript || subtitles.map((item) => item.text).join(' '), subtitles,
    warning: `${timingNote} 字幕整理与翻译阶段耗时 ${((Date.now() - translationStarted) / 1000).toFixed(1)} 秒。${processingNotes.join('')}${subtitles.some(item => !item.translation) && !processingNotes.some(note => note.includes('中文翻译未完成')) ? '部分中文翻译未完成，可稍后继续翻译。' : ''}` };
  job.updatedAt = Date.now();
}

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

// ============ 链接导入（视频 / 网页）：只产出“真实可得”的结果，禁止 AI 编造字幕 ============

const HTTP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EMBED_PARAMS = '&high_quality=1&danmaku=0&autoplay=0';

function youtubeEmbedFromId(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

/** 识别更多 YouTube 形式：youtu.be、v=、embed/、shorts/、live/ */
function extractYouTubeIdAny(url: string): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0];
  const m = path.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** 单次手动跟随重定向，返回最终 Location（防 SSRF、防无限跳）。 */
async function followRedirectOnce(url: string): Promise<string | null> {
  try {
    await assertSafeHttpUrl(url);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': HTTP_UA },
    });
    clearTimeout(t);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) return new URL(loc, url).toString();
    }
    if (res.url && res.url !== url) return res.url;
    return null;
  } catch {
    return null;
  }
}

/** 把各类视频链接解析成“真正可内嵌播放”的地址。返回 kind: youtube|bilibili|ted|direct|none */
async function resolveVideoEmbedUrl(raw: string): Promise<{ videoUrl: string; kind: string }> {
  let url = (raw || '').trim();
  if (!url) return { videoUrl: '', kind: 'none' };
  const lower = url.toLowerCase();

  // 直接视频文件
  if (/\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url)) return { videoUrl: url, kind: 'direct' };

  // YouTube
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    const id = extractYouTubeIdAny(url);
    if (id) return { videoUrl: youtubeEmbedFromId(id), kind: 'youtube' };
  }

  // TED 演讲
  if (lower.includes('ted.com/talks/')) {
    return { videoUrl: url.replace(/ted\.com\/talks\//i, 'embed.ted.com/talks/'), kind: 'ted' };
  }

  // Bilibili（直接页 / 已是 player 页）
  if (lower.includes('bilibili.com')) {
    if (lower.includes('player.bilibili.com/player.html')) {
      return { videoUrl: url, kind: 'bilibili' };
    }
    const bv = url.match(/BV[a-zA-Z0-9]{10}/i);
    if (bv) return { videoUrl: `https://player.bilibili.com/player.html?bvid=${bv[0]}${EMBED_PARAMS}`, kind: 'bilibili' };
    const av = url.match(/(?:av|aid=)(\d+)/i);
    if (av) return { videoUrl: `https://player.bilibili.com/player.html?aid=${av[1]}${EMBED_PARAMS}`, kind: 'bilibili' };
    return { videoUrl: '', kind: 'bilibili' }; // bilibili 域名但未能解析出号
  }

  // b23.tv 等短链：跟随重定向后重新识别
  if (/^https?:\/\/(b23\.tv|bili2233\.cn|shorturl\.at|dwz\.cn)/i.test(lower)) {
    const finalUrl = await followRedirectOnce(url);
    if (finalUrl && finalUrl !== url) {
      const r = await resolveVideoEmbedUrl(finalUrl);
      if (r.kind !== 'none') return r;
    }
  }

  return { videoUrl: '', kind: 'none' };
}

/** 抓取普通网页的真实正文与标题（SSRF 防护 + 手动重定向）。 */
async function scrapeWebpage(url: string): Promise<{ ok: boolean; title: string; description: string; text: string }> {
  try {
    await assertSafeHttpUrl(url);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': HTTP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, title: '', description: '', text: '' };
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    return {
      ok: true,
      title: titleMatch?.[1]?.trim() || '',
      description: descMatch?.[1]?.trim() || '',
      text: stripHtml(html),
    };
  } catch (e: any) {
    console.warn('[import-link] scrapeWebpage failed:', e?.message);
    return { ok: false, title: '', description: '', text: '' };
  }
}

/** 抓取 YouTube 官方字幕（timedtext），返回真实逐句字幕数组；取不到返回 null。 */
async function fetchYouTubeRealSubtitles(videoId: string): Promise<any[] | null> {
  try {
    const captionBaseUrl = await fetchYoutubeCaptionUrl(videoId);
    if (!captionBaseUrl) return null;
    const captionJsonUrl = `${captionBaseUrl}${captionBaseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    const res = await fetch(captionJsonUrl, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': HTTP_UA, 'Referer': `https://www.youtube.com/watch?v=${videoId}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const events: any[] = json.events || [];
    const subs: any[] = [];
    let c = 1;
    for (const ev of events) {
      if (!ev.segs || ev.segs.length === 0) continue;
      const text = ev.segs
        .map((s: any) => s.utf8 || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || /^\[music\]$/i.test(text) || /^music$/i.test(text)) continue;
      const startMs = ev.tStartMs || 0;
      const durMs = ev.dDurationMs || 0;
      subs.push({
        id: `yt-${c++}`,
        start: parseFloat((startMs / 1000).toFixed(2)),
        end: parseFloat(((startMs + durMs) / 1000).toFixed(2)),
        text,
        translation: '',
      });
    }
    return subs.length > 0 ? subs : null;
  } catch (e: any) {
    console.warn('[import-link] fetchYouTubeRealSubtitles failed:', e?.message);
    return null;
  }
}

// 链接导入（原名 crawl-video，路径保留以兼容前端；语义 = 导入链接，不编造字幕）
app.post('/api/materials/crawl-video', async (req, res) => {
  const { url } = req.body || {};
  try {
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: '请提供需要导入的链接。' });
    }
    const inputUrl = url.trim();

    // 1) 解析成“真正可内嵌”的视频地址（含 b23 短链展开）
    const resolved = await resolveVideoEmbedUrl(inputUrl);

    // 2) YouTube：优先尝试官方 CC（真实字幕）
    const ytId = extractYouTubeIdAny(inputUrl) || extractYouTubeIdAny(resolved.videoUrl);
    if (ytId) {
      const embedUrl = youtubeEmbedFromId(ytId);
      try {
        const real = await fetchYouTubeRealSubtitles(ytId);
        if (real && real.length > 0) {
          const ai = await getLLMClientForRequest(req);
          const truncated = real.slice(0, 100);
          const aiPrompt = `你是一位雅思英语教学专家。下面是从某个 YouTube 视频抓取到的【真实英文 CC 字幕】。
请只依据这些真实字幕完成任务，不要编造正文之外的内容：
1) 生成一个简洁吸引人的中文标题(title)。
2) 用中文写一段视频概要(summary，80字以内)。
3) 为下面列表中每条字幕生成精准中文翻译，放入 translations 数组（每条形如 {"id":"yt-1","translation":"中文"}）。
4) 从真实文稿中提炼 3 个雅思高频学术词放入 vocab。

【真实字幕片段】
"""
${truncated
    .map((s: any) => `${s.id} [${s.start}-${s.end}] ${s.text}`)
    .join('\n')}
"""

只返回 JSON：{"title":"","summary":"","translations":[{"id":"yt-1","translation":""}],"vocab":[{"word":"","partOfSpeech":"","chinese":"","definition":"","example":""}]}`;

          let title = '【YouTube】真实字幕精学材料';
          let summary = '基于该 YouTube 视频官方字幕提取的真实英语材料。';
          let vocab: any[] = [];
          const transMap = new Map<string, string>();
          try {
            const resp = await ai.models.generateContent({
              model: 'gemini-3.6-flash',
              contents: aiPrompt,
              config: { responseMimeType: 'application/json' },
            });
            const parsed: any = safeJSONParse(resp.text);
            if (parsed) {
              if (parsed.title) title = String(parsed.title);
              if (parsed.summary) summary = String(parsed.summary);
              if (Array.isArray(parsed.vocab)) vocab = parsed.vocab;
              if (Array.isArray(parsed.translations)) {
                for (const t of parsed.translations) {
                  if (t && t.id) transMap.set(String(t.id), t.translation || '');
                }
              }
            }
          } catch (e: any) {
            console.warn('[import-link] YouTube CC 翻译失败，将保留英文原文:', e?.message);
          }
          const subtitles = truncated.map((s: any) => ({ ...s, translation: transMap.get(s.id) || '' }));
          return res.json({
            title,
            summary,
            videoUrl: embedUrl,
            kind: 'youtube',
            captions: 'official',
            transcript: subtitles.map((s: any) => s.text).join(' '),
            subtitles,
            vocab,
          });
        }
      } catch (e: any) {
        console.warn('[import-link] YouTube CC 流程异常，退化为仅嵌视频:', e?.message);
      }
      // 无官方字幕 → 只嵌原视频，不生成任何内容
      return res.json({
        videoUrl: embedUrl,
        kind: 'youtube',
        captions: 'none',
        title: '',
        summary: '',
        transcript: '',
        subtitles: [],
        vocab: [],
        note: '已嵌入该 YouTube 原视频。此视频没有可用的官方字幕，请自行准备字幕文本并在下方粘贴，再使用「AI 分段 + 逐句中译」。',
      });
    }

    // 3) 其它可嵌入视频（B站 / TED / mp4 直链）
    if (resolved.kind !== 'none') {
      return res.json({
        videoUrl: resolved.videoUrl,
        kind: resolved.kind,
        captions: 'none',
        title: '',
        summary: '',
        transcript: '',
        subtitles: [],
        vocab: [],
        note:
          resolved.kind === 'direct'
            ? ''
            : '已嵌入该视频原播放器。由于该视频平台不开放字幕读取，请自行准备字幕文本并在下方粘贴后使用「AI 分段 + 逐句中译」。',
      });
    }

    // 4) 普通网页：抓真实正文，正文足够时才基于真实内容做摘要/生词（不是字幕）
    const page = await scrapeWebpage(inputUrl);
    const pageText = (page.text || '').trim();
    if (page.ok && pageText.length > 60) {
      const ai = await getLLMClientForRequest(req);
      const prompt = `你是一位雅思英语学习助手。下面是从一个网页抓取到的【真实英文正文】。请只依据这段文字输出（不要编造正文外内容）：
1) title：简洁中文标题（若已知道则用，否则概括）
2) summary：中文核心要点总结（100字以内）
3) vocab：从真实正文里提炼 3-5 个雅思核心词，每项含 word/partOfSpeech/chinese/definition/example

【真实正文】
"""
${pageText.slice(0, 4000)}
"""

只返回 JSON：{"title":"","summary":"","vocab":[{"word":"","partOfSpeech":"","chinese":"","definition":"","example":""}]}`;
      let out: any = { title: page.title || '网页材料', summary: '', vocab: [] };
      try {
        const resp = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        const parsed: any = safeJSONParse(resp.text);
        if (parsed && typeof parsed === 'object') {
          out = { ...out, ...parsed };
        }
      } catch (e: any) {
        console.warn('[import-link] 网页摘要生成失败，返回原文:', e?.message);
      }
      return res.json({
        ...out,
        kind: 'webpage',
        captions: 'none',
        videoUrl: '',
        transcript: pageText,
        vocab: Array.isArray(out.vocab) ? out.vocab : [],
      });
    }

    return res.status(422).json({
      error:
        '无法读取该链接的真实内容。请改用 YouTube / B站 / TED 视频链接、或 mp4 直链；也可以直接粘贴文本/字幕来创建材料。',
    });
  } catch (error: any) {
    console.error('Error importing link:', error);
    return res.status(500).json({ error: error?.message || '导入链接失败' });
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

function extractBalancedJson(source: string, start: number): string | null {
  const firstBrace = source.indexOf('{', start);
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(firstBrace, i + 1);
  }
  return null;
}

function getYoutubeCaptionTracks(playerResponse: any): any[] {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks.filter((track: any) => typeof track?.baseUrl === 'string') : [];
}

function selectYoutubeCaptionTrack(tracks: any[]): any | null {
  return tracks.find((track: any) => track.languageCode === 'en' && !track.kind)
    || tracks.find((track: any) => track.languageCode === 'en')
    || tracks[0]
    || null;
}

// Resolve official caption tracks from the watch page, then fall back to YouTube's player endpoint.
async function fetchYoutubeCaptionUrl(videoId: string): Promise<string | null> {
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`,
    `https://www.youtube.com/embed/${videoId}`
  ];

  for (const url of urls) {
    try {
      console.log(`[YouTube Captions Scraper] Trying url: ${url}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/'
        }
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Path A: ytInitialPlayerResponse JSON extraction
      const responseIndex = html.indexOf('ytInitialPlayerResponse');
      const playerResponseJson = responseIndex >= 0 ? extractBalancedJson(html, responseIndex) : null;
      if (playerResponseJson) {
        try {
          const track = selectYoutubeCaptionTrack(getYoutubeCaptionTracks(JSON.parse(playerResponseJson)));
          if (track?.baseUrl) {
            console.log(`[YouTube Captions Scraper] Found caption track in page response (${track.languageCode || 'unknown'})`);
            return track.baseUrl;
          }
        } catch (e: any) {
          console.warn('[YouTube Captions Scraper] Failed to parse player response:', e?.message);
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

  // Some watch-page variants omit the initial player response but include the API key.
  try {
    const pageRes = await fetch(urls[0], {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
      const contextIndex = html.indexOf('"INNERTUBE_CONTEXT"');
      const contextJson = contextIndex >= 0 ? extractBalancedJson(html, contextIndex) : null;
      let pageContext: any = null;
      if (contextJson) {
        try { pageContext = JSON.parse(contextJson); } catch { /* use safe client defaults */ }
      }
      if (apiKey) {
        const clients = [
          { name: 'WEB', headerName: '1', version: pageContext?.client?.clientVersion || '2.20240919.00.00' },
          { name: 'ANDROID', headerName: '3', version: '19.44.38' },
        ];
        for (const client of clients) {
          const context = pageContext || { client: {} };
          context.client = {
            ...context.client,
            clientName: client.name,
            clientVersion: client.version,
            hl: context.client?.hl || 'en',
            gl: context.client?.gl || 'US',
          };
          try {
            const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
              method: 'POST',
              signal: AbortSignal.timeout(12000),
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://www.youtube.com',
                'X-YouTube-Client-Name': client.headerName,
                'X-YouTube-Client-Version': client.version,
              },
              body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
            });
            if (!playerRes.ok) {
              console.warn(`[YouTube Captions Scraper] ${client.name} player request returned HTTP ${playerRes.status}`);
              continue;
            }
            const playerResponse = await playerRes.json();
            const track = selectYoutubeCaptionTrack(getYoutubeCaptionTracks(playerResponse));
            if (track?.baseUrl) {
              console.log(`[YouTube Captions Scraper] Found caption track via ${client.name} player endpoint (${track.languageCode || 'unknown'})`);
              return track.baseUrl;
            }
            console.warn(`[YouTube Captions Scraper] ${client.name} player endpoint returned no tracks; playability=${playerResponse?.playabilityStatus?.status || 'unknown'}`);
          } catch (err: any) {
            console.warn(`[YouTube Captions Scraper] ${client.name} player request failed:`, err?.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[YouTube Captions Scraper] Player endpoint fallback failed:', err?.message);
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

  let officialCaptionsFound = false;
  try {
    const captionBaseUrl = await fetchYoutubeCaptionUrl(videoId);
    if (!captionBaseUrl) {
      throw new Error('No caption track URL could be resolved directly from watch page or embed source. Subtitles may be disabled or restricted.');
    }

    // json3 returns timed caption events with start times and durations.
    const captionJsonUrl = `${captionBaseUrl}${captionBaseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    const captionRes = await fetch(captionJsonUrl, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': HTTP_UA, 'Referer': `https://www.youtube.com/watch?v=${videoId}` },
    });
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
    officialCaptionsFound = true;

    // Safety limit of 400 items to fit within standard model contexts comfortably
    const processedSubtitles = subtitles.slice(0, 400);

    // Official captions are useful without AI; translation is an optional enhancement.
    let translationNote = '';
    const transMap = new Map();
    try {
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
    if (parsedData && Array.isArray(parsedData.translations)) {
      parsedData.translations.forEach((t: any) => {
        transMap.set(t.id, t.translation);
      });
    }
    } catch (translationError: any) {
      if (translationError?.code === 'LLM_NOT_CONFIGURED' || translationError?.message === 'LLM_NOT_CONFIGURED') {
        translationNote = '已抓取官方英文字幕。配置 AI 模型后可自动生成中文翻译。';
      } else {
        throw translationError;
      }
    }

    const finalSubtitles = processedSubtitles.map(s => ({
      ...s,
      translation: transMap.get(s.id) || ''
    }));

    res.json({
      success: true,
      subtitles: finalSubtitles,
      source: 'YouTube 官方CC字幕',
      note: translationNote,
    });

  } catch (error: any) {
    console.warn(`Direct YouTube CC extraction failed for ${videoId}: ${error.message}`);
    if (officialCaptionsFound) {
      return res.status(502).json({
        code: 'YOUTUBE_CAPTION_TRANSLATION_FAILED',
        error: `已获取官方字幕，但 AI 翻译失败：${error.message || '请检查模型配置后重试。'}`,
      });
    }
    res.status(422).json({
      code: 'YOUTUBE_CAPTIONS_UNAVAILABLE',
      error: '无法获取该视频的官方字幕。这种情况下不会生成或估算视频台词与时间轴。请粘贴真实文稿或字幕，再使用 AI 翻译和分段。',
    });
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
