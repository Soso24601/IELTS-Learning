/** Fixed scene taxonomy. Keep this file identical in both independently deployed services. */
export const SCENE_DOMAINS = [
  { name: '居住与邻里', scenes: ['介绍自己的住处', '描述喜欢的房间', '与室友相处', '解决居住问题', '认识或帮助邻居', '搬家与选择住处'] },
  { name: '饮食与做饭', scenes: ['平时吃什么', '自己做一顿饭', '做饭失败与补救', '和亲友外出吃饭', '推荐餐馆或家乡食物', '改变饮食习惯'] },
  { name: '购物与消费', scenes: ['挑选和比较商品', '一次满意的购物', '买到不合适的东西', '网购与配送', '购买或赠送礼物', '攒钱购买想要的东西'] },
  { name: '学习与校园', scenes: ['学习一项新知识', '准备考试与赶截止日期', '向老师或同学求助', '小组合作', '参加课程或校园活动', '安排学习与休息'] },
  { name: '工作与职业', scenes: ['介绍日常工作', '完成困难任务', '与同事合作', '处理失误和突发问题', '收到建议或认可', '选择工作与未来规划'] },
  { name: '出行与旅行', scenes: ['日常通勤', '迟到、堵车与交通延误', '计划一次旅行', '旅行中改变计划', '住宿与当地体验', '推荐或重访一个地方'] },
  { name: '家人与朋友', scenes: ['介绍重要的人', '和亲友一起做事', '认识新朋友', '帮助或安慰别人', '处理分歧', '聚会、庆祝与重逢'] },
  { name: '兴趣与休闲', scenes: ['开始一个新爱好', '运动与户外活动', '看电影、听音乐或阅读', '独处与放松', '参加比赛或现场活动', '分享或推荐喜欢的事物'] },
  { name: '健康与生活习惯', scenes: ['日常运动与保持健康', '睡眠与作息', '生病与恢复', '缓解压力', '减少不良习惯', '坚持一个新的生活习惯'] },
  { name: '科技与媒体', scenes: ['使用常用设备或应用', '学习使用新工具', '遇到和解决技术问题', '刷手机与管理屏幕时间', '获取新闻和信息', '拍照、记录与分享生活'] },
  { name: '社区与公共生活', scenes: ['使用图书馆、公园等公共设施', '参加社区或志愿活动', '获得服务或提出投诉', '改善周边环境', '参加节日或文化活动', '观察家乡和城市变化'] },
  { name: '成长与重要经历', scenes: ['第一次独立完成一件事', '做出困难决定', '计划落空与应对变化', '犯错与吸取教训', '克服害怕或挑战', '实现目标与获得成就'] },
];
export const PRACTICE_DIRECTIONS = ['日常问答', '经历讲述', '深入讨论'];
export const EXPRESSION_USES = ['描述人物', '描述地点或事物', '讲述经过', '表达喜好与感受', '解释原因', '比较与选择', '提出需求与建议', '说明问题与解决办法', '评价利弊', '讨论变化与未来'];
export interface SceneClassification {
  domain: string;
  primary: string;
  related: string[];
  practice: string[];
  uses: string[];
}
export function scenesInDomain(domain: string): string[] {
  return SCENE_DOMAINS.find(item => item.name === domain)?.scenes || [];
}
export function sceneNames(scene?: SceneClassification): string[] {
  return scene ? [scene.primary, ...scene.related] : [];
}
export function matchesScene(scene: SceneClassification | undefined, domain = '', selected = '', practice = '', use = ''): boolean {
  if (domain === 'unclassified') return !scene && !selected && !practice && !use;
  const names = sceneNames(scene);
  return (!domain || names.some(name => scenesInDomain(domain).includes(name)))
    && (!selected || names.includes(selected))
    && (!practice || !!scene?.practice.includes(practice))
    && (!use || !!scene?.uses.includes(use));
}
/** Legacy records may omit classification. Supplied data must match the fixed taxonomy. */
export function validateSceneClassification(value: unknown): SceneClassification | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('场景分类格式无效');
  const raw = value as Record<string, unknown>;
  if (typeof raw.domain !== 'string' || !SCENE_DOMAINS.some(item => item.name === raw.domain)) throw new Error('请选择有效的生活领域');
  if (typeof raw.primary !== 'string' || !scenesInDomain(raw.domain).includes(raw.primary)) throw new Error('主场景必须属于所选生活领域');
  const list = (key: string, allowed: string[], max: number) => {
    if (!Array.isArray(raw[key]) || raw[key].length > max || raw[key].some(item => typeof item !== 'string' || !allowed.includes(item))) throw new Error('场景选项无效或超过数量限制：' + key);
    return [...new Set(raw[key] as string[])];
  };
  const related = list('related', SCENE_DOMAINS.flatMap(item => item.scenes), 2);
  if (related.includes(raw.primary)) throw new Error('关联场景不能与主场景重复');
  return { domain: raw.domain, primary: raw.primary, related, practice: list('practice', PRACTICE_DIRECTIONS, 3), uses: list('uses', EXPRESSION_USES, 10) };
}

