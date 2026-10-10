/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IELTSWord } from '../types';

export const presetVocabulary: IELTSWord[] = [
  // --- EDUCATION & COGNITION ---
  {
    id: 'w1',
    word: 'cognitive',
    phonetic: '/ˈkɒɡ.nə.tɪv/',
    partOfSpeech: 'adj.',
    chinese: '认知的，感知的',
    definition: 'Relating to the mental action or process of acquiring knowledge and understanding through thought, experience, and the senses.',
    example: 'Early childhood education plays a crucial role in fostering a child\'s cognitive development.',
    exampleTranslation: '早期儿童教育在促进孩子认知发展方面起着至关重要的作用。',
    category: 'reading',
    topic: 'Education'
  },
  {
    id: 'w2',
    word: 'advocate',
    phonetic: '/ˈæd.və.keɪt/',
    partOfSpeech: 'v. / n.',
    chinese: '提倡，拥护；主张者',
    definition: 'Publicly recommend or support a particular cause, policy, or action.',
    example: 'Many environmentalists advocate for the reduction of carbon emissions to combat global warming.',
    exampleTranslation: '许多环保主义者主张减少碳排放以对抗全球变暖。',
    category: 'writing',
    topic: 'Education',
    sourceMaterialId: 'm2',
    sourceMaterialName: 'IELTS Writing Task 2 Model Essay',
    sourceSentence: 'Personally, I advocate a more balanced view.'
  },
  {
    id: 'w3',
    word: 'empirical',
    phonetic: '/ɪmˈpɪr.ɪ.kəl/',
    partOfSpeech: 'adj.',
    chinese: '经验主义的，基于经验的',
    definition: 'Based on, concerned with, or verifiable by observation or experience rather than theory or pure logic.',
    example: 'The scientific team provided solid empirical evidence to support their hypothesis.',
    exampleTranslation: '该科学团队提供了坚实的实证证据来支持他们的假设。',
    category: 'reading',
    topic: 'Science',
    sourceMaterialId: 'm1',
    sourceMaterialName: 'The Impact of Climate Change on Cities',
    sourceSentence: 'Empirical evidence suggests that green roofs and solar panels can substantially reduce energy consumption and alleviate heat-island effects in metropolitan regions.'
  },
  {
    id: 'w4',
    word: 'foster',
    phonetic: '/ˈfɒs.tər/',
    partOfSpeech: 'v.',
    chinese: '培养，促进，收养',
    definition: 'Encourage or promote the development of something, typically something regarded as good.',
    example: 'Collaborative projects can foster team spirit and improve communication skills among students.',
    exampleTranslation: '协作项目可以培养团队精神，并提高学生之间的沟通技巧。',
    category: 'speaking',
    topic: 'Education',
    sourceMaterialId: 'm3',
    sourceMaterialName: 'Speaking Part 3 - Technological Influence',
    sourceSentence: 'The integration of interactive tablets and educational software allows students to learn at their own pace, fostering independent thinking.'
  },
  {
    id: 'w5',
    word: 'validate',
    phonetic: '/ˈvæl.ɪ.deɪt/',
    partOfSpeech: 'v.',
    chinese: '证实，使生效，使合理',
    definition: 'Check or prove the validity or accuracy of something.',
    example: 'Further research is required to validate the effectiveness of this new treatment.',
    exampleTranslation: '需要进一步的研究来验证这种新疗法的有效性。',
    category: 'listening',
    topic: 'Science'
  },

  // --- ENVIRONMENT & SUSTAINABILITY ---
  {
    id: 'w6',
    word: 'mitigate',
    phonetic: '/ˈmɪt.ɪ.ɡeɪt/',
    partOfSpeech: 'v.',
    chinese: '缓解，减轻，缓和',
    definition: 'Make less severe, serious, or painful.',
    example: 'The government has introduced several measures to mitigate the economic impact of the natural disaster.',
    exampleTranslation: '政府已经出台了多项措施来缓解自然灾害带来的经济影响。',
    category: 'writing',
    topic: 'Environment',
    sourceMaterialId: 'm1',
    sourceMaterialName: 'The Impact of Climate Change on Cities',
    sourceSentence: 'To mitigate these risks, municipal governments must transition to sustainable infrastructure.'
  },
  {
    id: 'w7',
    word: 'sustain',
    phonetic: '/səˈsteɪn/',
    partOfSpeech: 'v.',
    chinese: '维持，承受，支撑',
    definition: 'Strengthen or support physically or mentally; cause to continue for an extended period.',
    example: 'Organic farming methods help to sustain soil fertility and protect the local ecosystem.',
    exampleTranslation: '有机农业方法有助于维持土壤肥力并保护当地生态系统。',
    category: 'writing',
    topic: 'Environment'
  },
  {
    id: 'w8',
    word: 'deteriorate',
    phonetic: '/dɪˈtɪə.ri.ə.reɪt/',
    partOfSpeech: 'v.',
    chinese: '恶化，变坏',
    definition: 'Become progressively worse over time.',
    example: 'If local industries continue to dump wastes, the quality of water in this river will deteriorate further.',
    exampleTranslation: '如果当地工业继续倾倒废物，这条河的水质将会进一步恶化。',
    category: 'reading',
    topic: 'Environment'
  },
  {
    id: 'w9',
    word: 'unprecedented',
    phonetic: '/ʌnˈpres.ɪ.den.tɪd/',
    partOfSpeech: 'adj.',
    chinese: '空前的，史无前例的',
    definition: 'Never done or known before; completely new in style or scale.',
    example: 'The rapid rise in global temperatures has caused an unprecedented melting of glaciers.',
    exampleTranslation: '全球气温的迅速上升导致了史无前例的冰川融化。',
    category: 'reading',
    topic: 'Environment'
  },
  {
    id: 'w10',
    word: 'deplete',
    phonetic: '/dɪˈpliːt/',
    partOfSpeech: 'v.',
    chinese: '耗尽，使枯竭',
    definition: 'Use up the supply or resources of something, leading to exhaustion.',
    example: 'Over-exploitation of natural gas will rapidly deplete the country\'s energy reserves.',
    exampleTranslation: '对天然气的过度开发将迅速耗尽该国的能源储备。',
    category: 'reading',
    topic: 'Environment'
  },

  // --- TECHNOLOGY & INNOVATION ---
  {
    id: 'w11',
    word: 'obsolete',
    phonetic: '/ˌɒb.səˈliːt/',
    partOfSpeech: 'adj.',
    chinese: '淘汰的，过时的',
    definition: 'No longer produced or used; out of date.',
    example: 'With the advent of smartphones, traditional film cameras have become virtually obsolete.',
    exampleTranslation: '随着智能手机的出现，传统的胶片相机实际上已经过时。',
    category: 'reading',
    topic: 'Technology'
  },
  {
    id: 'w12',
    word: 'innovative',
    phonetic: '/ˈɪn.ə.və.tɪv/',
    partOfSpeech: 'adj.',
    chinese: '创新的，新颖的',
    definition: 'Introducing new ideas; original and creative in thinking.',
    example: 'The tech startup won an award for its innovative approach to waste recycling.',
    exampleTranslation: '这家科技初创公司因其创新的垃圾回收方法而获奖。',
    category: 'speaking',
    topic: 'Technology'
  },
  {
    id: 'w13',
    word: 'paradigm',
    phonetic: '/ˈpær.ə.daɪm/',
    partOfSpeech: 'n.',
    chinese: '范式，典范，样板',
    definition: 'A typical example or pattern of something; a model or cognitive framework.',
    example: 'Artificial Intelligence represents a paradigm shift in how we process and analyze vast data.',
    exampleTranslation: '人工智能代表了我们在处理 and 分析庞大数据方面的一种范式转移。',
    category: 'writing',
    topic: 'Technology'
  },
  {
    id: 'w14',
    word: 'facilitate',
    phonetic: '/fəˈsɪl.ɪ.teɪt/',
    partOfSpeech: 'v.',
    chinese: '促进，使便利，帮助',
    definition: 'Make an action or process easy or easier.',
    example: 'Modern telecommunication tools facilitate remote work and enhance productivity.',
    exampleTranslation: '现代电信工具促进了远程工作并提高了生产力。',
    category: 'writing',
    topic: 'Technology'
  },
  {
    id: 'w15',
    word: 'autonomous',
    phonetic: '/ɔːˈtɒn.ə.məs/',
    partOfSpeech: 'adj.',
    chinese: '自主的，自治的，独立的',
    definition: 'Acting independently or having the freedom to do so; self-governing.',
    example: 'Many automotive giants are currently investing in the development of autonomous vehicles.',
    exampleTranslation: '许多汽车巨头目前正在投资研发无人驾驶（自主）汽车。',
    category: 'reading',
    topic: 'Technology'
  },

  // --- CULTURE, SOCIETY & ART ---
  {
    id: 'w16',
    word: 'aesthetic',
    phonetic: '/esˈθet.ɪk/',
    partOfSpeech: 'adj. / n.',
    chinese: '美学的，审美的；美感',
    definition: 'Concerned with beauty or the appreciation of beauty.',
    example: 'The newly constructed theater was praised for both its functional design and aesthetic appeal.',
    exampleTranslation: '新建成的剧院因其功能性设计和美学吸引力而受到赞誉。',
    category: 'speaking',
    topic: 'Culture'
  },
  {
    id: 'w17',
    word: 'profound',
    phonetic: '/prəˈfaʊnd/',
    partOfSpeech: 'adj.',
    chinese: '深远的，深刻的，渊博的',
    definition: 'Very great or intense; having or showing great knowledge or insight.',
    example: 'The industrial revolution had a profound influence on the structure of human society.',
    exampleTranslation: '工业革命对人类社会的结构产生了深远的影响。',
    category: 'speaking',
    topic: 'Culture'
  },
  {
    id: 'w18',
    word: 'bias',
    phonetic: '/ˈbaɪ.əs/',
    partOfSpeech: 'n. / v.',
    chinese: '偏见，偏向',
    definition: 'Prejudice in favor of or against one thing, person, or group compared with another, usually in an unfair way.',
    example: 'Reporters must strive to present the news objectively without any political bias.',
    exampleTranslation: '记者必须努力客观地报道新闻，不带有任何政治偏见。',
    category: 'speaking',
    topic: 'Culture'
  },
  {
    id: 'w19',
    word: 'homogenize',
    phonetic: '/həˈmɒdʒ.ɪ.naɪz/',
    partOfSpeech: 'v.',
    chinese: '使均匀，使同质化',
    definition: 'Make uniform or similar across a wide scope, often removing cultural uniqueness.',
    example: 'Critics argue that globalization tends to homogenize diverse cultures into a single global standard.',
    exampleTranslation: '批评人士指出，全球化往往会将多元文化同质化为单一的全球标准。',
    category: 'reading',
    topic: 'Culture'
  },
  {
    id: 'w20',
    word: 'heritage',
    phonetic: '/ˈher.ɪ.tɪdʒ/',
    partOfSpeech: 'n.',
    chinese: '遗产，传统',
    definition: 'Property, traditions, or values that are inherited from previous generations.',
    example: 'It is our collective responsibility to preserve historical monuments as part of our cultural heritage.',
    exampleTranslation: '保护历史古迹作为我们文化遗产的一部分，是我们共同的责任。',
    category: 'speaking',
    topic: 'Culture'
  },

  // --- ECONOMY, POLICY & SOCIETY ---
  {
    id: 'w21',
    word: 'fluctuate',
    phonetic: '/ˈflʌk.tʃu.eɪt/',
    partOfSpeech: 'v.',
    chinese: '波动，起伏，涨落',
    definition: 'Rise and fall irregularly in number or amount.',
    example: 'Vegetable prices tend to fluctuate according to seasonal supply and weather conditions.',
    exampleTranslation: '蔬菜价格往往根据季节性供应和天气状况而波动。',
    category: 'listening',
    topic: 'Economy'
  },
  {
    id: 'w22',
    word: 'alleviate',
    phonetic: '/əˈliː.vi.eɪt/',
    partOfSpeech: 'v.',
    chinese: '缓解，减轻（痛苦、问题等）',
    definition: 'Make (suffering, deficiency, or a problem) less severe.',
    example: 'Tax exemptions for low-income families are intended to alleviate financial burdens.',
    exampleTranslation: '对低收入家庭免税旨在减轻其财务负担。',
    category: 'writing',
    topic: 'Economy'
  },
  {
    id: 'w23',
    word: 'disparity',
    phonetic: '/dɪˈspær.ə.ti/',
    partOfSpeech: 'n.',
    chinese: '巨大差异，不平等',
    definition: 'A great difference or inequality, especially one that is perceived as unfair.',
    example: 'There remains a substantial wealth disparity between urban centers and rural villages.',
    exampleTranslation: '城市中心与农村村庄之间仍存在巨大的财富差距。',
    category: 'writing',
    topic: 'Economy'
  },
  {
    id: 'w24',
    word: 'comprehensive',
    phonetic: '/ˌkɒm.prɪˈhen.sɪv/',
    partOfSpeech: 'adj.',
    chinese: '全面的，综合的，详尽的',
    definition: 'Complete; including all or nearly all elements or aspects of something.',
    example: 'The insurance policy offers comprehensive coverage against fire, theft, and natural disasters.',
    exampleTranslation: '该保险单提供针对火灾、盗窃和自然灾害的全面保障。',
    category: 'reading',
    topic: 'Economy'
  },
  {
    id: 'w25',
    word: 'monopolize',
    phonetic: '/məˈnɒp.əl.aɪz/',
    partOfSpeech: 'v.',
    chinese: '垄断，独占',
    definition: 'Obtain exclusive possession or control of a trade, commodity, or service.',
    example: 'Regulations are necessary to prevent tech giants from attempts to monopolize the digital advertising market.',
    exampleTranslation: '法规是必要的，以防止科技巨头企图垄断数字广告市场。',
    category: 'reading',
    topic: 'Economy'
  },

  // --- LOGIC, INQUIRY & CRITICAL THINKING ---
  {
    id: 'w26',
    word: 'scrutinize',
    phonetic: '/ˈskruː.tɪ.naɪz/',
    partOfSpeech: 'v.',
    chinese: '仔细检查，审视',
    definition: 'Examine or inspect closely and thoroughly.',
    example: 'Auditors will closely scrutinize all company transactions to detect any financial irregularities.',
    exampleTranslation: '审计师将仔细审查所有公司交易，以发现任何财务违规行为。',
    category: 'listening',
    topic: 'Science'
  },
  {
    id: 'w27',
    word: 'plausible',
    phonetic: '/ˈplɔː.zə.bəl/',
    partOfSpeech: 'adj.',
    chinese: '合理的，似有道理的，可信的',
    definition: 'Seeming reasonable or probable; believable.',
    example: 'The detective found the suspect\'s alibi to be highly plausible given the time of the event.',
    exampleTranslation: '鉴于事件发生的时间，侦探发现嫌疑人的不在场证明高度可信。',
    category: 'speaking',
    topic: 'Science'
  },
  {
    id: 'w28',
    word: 'paradox',
    phonetic: '/ˈpær.ə.dɒks/',
    partOfSpeech: 'n.',
    chinese: '悖论，自相矛盾的人或事',
    definition: 'A seemingly absurd or self-contradictory statement or proposition that when investigated or explained may prove to be well founded or true.',
    example: 'It is a curious paradox that drinking plenty of water can sometimes make you feel more dehydrated if salts are low.',
    exampleTranslation: '一个奇妙的悖论是，如果身体盐分过低，喝大量的水有时反而会让你感到更加脱水。',
    category: 'speaking',
    topic: 'Science'
  },
  {
    id: 'w29',
    word: 'distort',
    phonetic: '/dɪˈstɔːt/',
    partOfSpeech: 'v.',
    chinese: '歪曲，扭曲',
    definition: 'Pull or twist out of shape; give a misleading or false account or impression of.',
    example: 'Social media algorithms can sometimes distort reality by reinforcing a user\'s pre-existing opinions.',
    exampleTranslation: '社交媒体算法有时会通过强化用户原有的观点来扭曲现实。',
    category: 'listening',
    topic: 'Science'
  },
  {
    id: 'w30',
    word: 'resilient',
    phonetic: '/rɪˈzɪl.i.ənt/',
    partOfSpeech: 'adj.',
    chinese: '有韧性的，能迅速恢复的',
    definition: 'Able to withstand or recover quickly from difficult conditions.',
    example: 'To thrive in today\'s fast-paced corporate environment, employees must remain resilient in the face of setbacks.',
    exampleTranslation: '为了在当今快节奏的公司环境中蓬勃发展，员工必须在面对挫折时保持韧性。',
    category: 'speaking',
    topic: 'Science'
  },

  // --- GENERAL ACADEMIC WORDS (BAND 6.0+) ---
  {
    id: 'w31',
    word: 'aggregate',
    phonetic: '/ˈæɡ.rɪ.ɡət/',
    partOfSpeech: 'n. / adj. / v.',
    chinese: '总数，合计；合计的；聚集',
    definition: 'A whole formed by combining several separate elements; form or group into a class or cluster.',
    example: 'The aggregate score of the two matches decided which team advanced to the finals.',
    exampleTranslation: '两场比赛的总比分决定了哪支球队晋级决赛。',
    category: 'listening',
    topic: 'Economy'
  },
  {
    id: 'w32',
    word: 'consensus',
    phonetic: '/kənˈsen.səs/',
    partOfSpeech: 'n.',
    chinese: '共识，一致意见',
    definition: 'A general agreement about something among a group of people.',
    example: 'After hours of intense debate, the committee members finally reached a consensus on the new budget.',
    exampleTranslation: '经过数小时的激烈辩论，委员会成员最终就新预算达成了共识。',
    category: 'speaking',
    topic: 'Education'
  },
  {
    id: 'w33',
    word: 'pragmatic',
    phonetic: '/præɡˈmæt.ɪk/',
    partOfSpeech: 'adj.',
    chinese: '务实的，重实效的',
    definition: 'Dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations.',
    example: 'The mayor took a pragmatic approach to solving the city\'s chronic traffic congestion problems.',
    exampleTranslation: '市长采取了务实的方法来解决该市慢性的交通拥堵问题。',
    category: 'speaking',
    topic: 'Economy'
  },
  {
    id: 'w34',
    word: 'synthesize',
    phonetic: '/ˈsɪn.θə.saɪz/',
    partOfSpeech: 'v.',
    chinese: '合成，综合，结合',
    definition: 'Combine a number of things into a coherent whole.',
    example: 'In your IELTS writing essay, you should synthesize arguments from both perspectives to form a balanced conclusion.',
    exampleTranslation: '在你的雅思作文中，你应该综合双方的论点，以形成一个平衡的结论。',
    category: 'writing',
    topic: 'Education'
  },
  {
    id: 'w35',
    word: 'subtle',
    phonetic: '/ˈsʌt.əl/',
    partOfSpeech: 'adj.',
    chinese: '微妙的，不易察觉的',
    definition: 'So delicate or precise as to be difficult to analyze or describe.',
    example: 'There are subtle differences in meaning between these two English synonyms.',
    exampleTranslation: '这两个英语同义词之间存在着微妙的意思差别。',
    category: 'speaking',
    topic: 'Culture'
  },
  {
    id: 'w36',
    word: 'evaluate',
    phonetic: '/ɪˈvæl.ju.eɪt/',
    partOfSpeech: 'v.',
    chinese: '评估，评价，估值',
    definition: 'Form an idea of the amount, number, or value of; assess.',
    example: 'We need to evaluate the potential risks and benefits before making any investment decision.',
    exampleTranslation: '在做出任何投资决定之前，我们需要评估潜在的风险和收益。',
    category: 'listening',
    topic: 'Science'
  },
  {
    id: 'w37',
    word: 'explicit',
    phonetic: '/ɪkˈsplɪs.ɪt/',
    partOfSpeech: 'adj.',
    chinese: '明确的，直截了当的，详述的',
    definition: 'Stated clearly and in detail, leaving no room for confusion or doubt.',
    example: 'The teacher gave explicit instructions on how to structure the writing essay.',
    exampleTranslation: '老师对如何构建写作文章给出了明确的指导。',
    category: 'listening',
    topic: 'Education'
  },
  {
    id: 'w38',
    word: 'implicit',
    phonetic: '/ɪmˈplɪs.ɪt/',
    partOfSpeech: 'adj.',
    chinese: '暗示的，含蓄的，不言而喻的',
    definition: 'Implied though not plainly expressed; essentially or very closely connected with.',
    example: 'There was an implicit agreement between the partners that profits would be shared equally.',
    exampleTranslation: '合伙人之间存在着一项默示协议，即利润将均分。',
    category: 'listening',
    topic: 'Culture'
  },
  {
    id: 'w39',
    word: 'reinforce',
    phonetic: '/ˌriː.ɪnˈfɔːs/',
    partOfSpeech: 'v.',
    chinese: '加强，强化，加固',
    definition: 'Strengthen or support, especially with additional personnel or material.',
    example: 'Reading newspapers in English is an excellent way to reinforce your passive vocabulary.',
    exampleTranslation: '阅读英文报纸是强化你被动词汇的极佳方式。',
    category: 'speaking',
    topic: 'Education'
  },
  {
    id: 'w40',
    word: 'trigger',
    phonetic: '/ˈtrɪɡ.ər/',
    partOfSpeech: 'v. / n.',
    chinese: '触发，引起；起因，板机',
    definition: 'Cause (an event or situation) to happen or exist.',
    example: 'In some individuals, severe stress can trigger various physical ailments.',
    exampleTranslation: '在某些人身上，严重的压力会引发各种身体疾病。',
    category: 'listening',
    topic: 'Science'
  }
];
