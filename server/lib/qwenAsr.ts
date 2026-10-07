import type { ASRResult } from './parallelAsr';

export async function transcribeQwenFile(mediaUrl: string, config: { region: 'beijing' | 'singapore'; apiKey: string }, deadline = Date.now() + 10 * 60 * 1000): Promise<ASRResult> {
  if (Date.now() >= deadline) throw new Error('完整音轨识别已超时，未继续提交分段。');
  const baseUrl = config.region === 'beijing' ? 'https://dashscope.aliyuncs.com/api/v1' : 'https://dashscope-intl.aliyuncs.com/api/v1';
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`${baseUrl}/services/audio/asr/transcription`, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { ...headers, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: 'qwen3-asr-flash-filetrans', input: { file_url: mediaUrl }, parameters: { channel_id: [0], enable_itn: false, enable_words: false } }),
  });
  const submitData: any = await submit.json().catch(() => ({}));
  if (!submit.ok || !submitData.output?.task_id) throw new Error(submitData.message || submitData.code || `百炼提交任务失败（HTTP ${submit.status}），请确认 API Key 地域和账户权限。`);


  let taskData: any;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const poll = await fetch(`${baseUrl}/tasks/${encodeURIComponent(submitData.output.task_id)}`, { headers, signal: AbortSignal.timeout(30000) });
    taskData = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(taskData.message || taskData.code || `查询百炼任务失败（HTTP ${poll.status}）。`);
    const status = taskData.output?.task_status;
    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'UNKNOWN') throw new Error(taskData.output?.message || taskData.message || `百炼识别任务${status === 'FAILED' ? '失败' : '已失效'}。`);
  }
  if (taskData?.output?.task_status !== 'SUCCEEDED') throw new Error('百炼识别等待超时，请稍后查询任务或重试。');
  const resultUrl = taskData.output?.result?.transcription_url;
  if (!resultUrl) throw new Error('百炼任务已完成，但没有返回识别结果地址。');
  const safeResultUrl = new URL(resultUrl);
  if (!safeResultUrl.hostname.endsWith('.aliyuncs.com')) throw new Error('百炼返回了无法验证的结果地址。');
  safeResultUrl.protocol = 'https:';
  const fileResultResponse = await fetch(safeResultUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!fileResultResponse.ok) throw new Error(`下载百炼识别结果失败（HTTP ${fileResultResponse.status}）。`);
  const fileResult: any = await fileResultResponse.json();
  const transcript = fileResult.transcripts?.[0]?.text || '';
  const sentences: any[] = fileResult.transcripts?.[0]?.sentences || [];
  const subtitles = sentences.filter((item) => typeof item.text === 'string' && item.text.trim()).map((item, index) => ({
    id: `asr-${Date.now()}-${index}`,
    start: Number((Math.max(0, Number(item.begin_time) || 0) / 1000).toFixed(2)),
    end: Number((Math.max(Number(item.begin_time) + 250, Number(item.end_time) || Number(item.begin_time) + 1000) / 1000).toFixed(2)),
    text: item.text.trim(),
    translation: '',
  }));
  return { transcript, subtitles };

}
