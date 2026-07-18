import fs from 'node:fs/promises';
import path from 'node:path';

const SAMPLE_INTERVAL_MS = 5000;

function safeOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' ? url.origin : url.protocol;
  } catch {
    return 'unknown';
  }
}

export class PerformanceRecorder {
  constructor({ app, getMainWindow, outputPath }) {
    this.app = app;
    this.getMainWindow = getMainWindow;
    this.outputPath = outputPath || path.join(
      app.getPath('userData'),
      'benchmarks',
      `metrics-${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`
    );
    this.timer = null;
    this.writeQueue = Promise.resolve();
    this.startedAt = Date.now();
  }

  async start(metadata = {}) {
    await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
    await this.record('benchmark-started', metadata);
    await this.sample();
    this.timer = setInterval(() => {
      void this.sample().catch((error) => {
        console.warn('[Benchmark] Sample failed:', error.message);
      });
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
    console.log(`[Benchmark] Metrics: ${this.outputPath}`);
  }

  record(type, data = {}) {
    const entry = {
      type,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      ...data
    };
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => fs.appendFile(this.outputPath, `${JSON.stringify(entry)}\n`, 'utf8'));
    return this.writeQueue;
  }

  async sample() {
    const mainWindow = this.getMainWindow();
    const [mainMemory, metrics] = await Promise.all([
      process.getProcessMemoryInfo(),
      Promise.resolve(this.app.getAppMetrics())
    ]);
    const processes = metrics.map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpu: metric.cpu,
      memory: metric.memory,
      sandboxed: metric.sandboxed,
      integrityLevel: metric.integrityLevel
    }));

    await this.record('sample', {
      mainProcessMemoryKb: mainMemory,
      totalWorkingSetKb: processes.reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0),
      totalPrivateKb: processes.reduce((sum, metric) => sum + (metric.memory?.privateBytes || 0), 0),
      processes,
      window: mainWindow && !mainWindow.isDestroyed()
        ? {
            visible: mainWindow.isVisible(),
            minimized: mainWindow.isMinimized(),
            origin: safeOrigin(mainWindow.webContents.getURL())
          }
        : null
    });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.record('benchmark-stopped');
    await this.writeQueue;
  }
}
