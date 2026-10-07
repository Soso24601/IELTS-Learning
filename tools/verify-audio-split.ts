// Run inside the production Docker image (FFmpeg and ffprobe required).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { splitAudio } from '../server/lib/parallelAsr';

const run = promisify(execFile);
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ielts-split-verify-'));
  try {
    const source = path.join(directory, 'input.flac');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=21', '-c:a', 'flac', source]);
    const started = Date.now();
    const parts = await splitAudio(source, directory, 5);
    const decode = async (file: string) => (await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
    const original = await decode(source);
    const reconstructed = Buffer.concat(await Promise.all(parts.map(part => decode(part.path))));
    assert.deepEqual(reconstructed, original, 'every audio sample must survive segmentation exactly once');
    assert.equal(parts[0].start, 0);
    assert.ok(Math.abs(parts.at(-1)!.end - 21) < 0.01);
    assert.equal(parts.length, 5);
    console.log(JSON.stringify({ passed: true, parts: parts.length, sourceSamples: original.length / 2, reconstructedSamples: reconstructed.length / 2, testElapsedMs: Date.now() - started }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
