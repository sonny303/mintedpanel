#!/usr/bin/env node

import os from "node:os";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const trials = Number.parseInt(process.env.MATRIX_BROWSER_TRIALS ?? "10", 10);
if (!Number.isFinite(trials) || trials < 5) {
  throw new Error("MATRIX_BROWSER_TRIALS must be at least 5.");
}

const sandboxChromium = "/opt/pw-browsers/chromium";
const systemChrome = "/usr/local/bin/google-chrome";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(sandboxChromium)
    ? sandboxChromium
    : existsSync(systemChrome)
      ? systemChrome
      : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.setContent(`
<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font: 13px system-ui, sans-serif; }
      #root { width: 1440px; overflow: auto; }
      table { border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #e8e5e0; height: 40px; padding: 0 8px; }
      th { min-width: 220px; text-align: left; }
      td { min-width: 140px; }
      button { width: 100%; border: 0; background: transparent; text-align: left; }
    </style>
  </head>
  <body><div id="root"></div></body>
</html>
`);

const result = await page.evaluate(
  async ({ trialCount }) => {
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    };
    const summarize = (values) => ({
      trials: values.length,
      p50Ms: Number(percentile(values, 0.5).toFixed(1)),
      p95Ms: Number(percentile(values, 0.95).toFixed(1)),
      minMs: Number(Math.min(...values).toFixed(1)),
      maxMs: Number(Math.max(...values).toFixed(1)),
    });
    const nextPaint = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const render = async (providerCount, renderedProviderCount) => {
      const root = document.querySelector("#root");
      if (!(root instanceof HTMLElement)) throw new Error("Benchmark root is missing.");
      root.replaceChildren();
      await nextPaint();

      const started = performance.now();
      const table = document.createElement("table");
      const header = document.createElement("tr");
      const providerHeader = document.createElement("th");
      providerHeader.textContent = "Provider";
      header.append(providerHeader);
      for (let payer = 1; payer <= 20; payer += 1) {
        const th = document.createElement("th");
        th.textContent = `Payer ${payer}`;
        header.append(th);
      }
      const thead = document.createElement("thead");
      thead.append(header);
      table.append(thead);

      const tbody = document.createElement("tbody");
      for (let provider = 1; provider <= renderedProviderCount; provider += 1) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = `Provider ${provider} of ${providerCount}`;
        tr.append(th);
        for (let payer = 1; payer <= 20; payer += 1) {
          const td = document.createElement("td");
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("aria-label", `Provider ${provider}, Payer ${payer}: In review`);
          const status = document.createElement("span");
          status.textContent = "In review";
          button.append(status);
          td.append(button);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      root.append(table);
      void table.getBoundingClientRect();
      await nextPaint();
      const elapsed = performance.now() - started;
      return {
        elapsed,
        elementCount: root.querySelectorAll("*").length,
        cellCount: renderedProviderCount * 20,
      };
    };

    const rows = [];
    for (const providerCount of [500, 1500, 3000]) {
      for (const strategy of ["all_rows", "virtual_window_50"]) {
        const renderedProviderCount = strategy === "all_rows" ? providerCount : 50;
        await render(providerCount, renderedProviderCount);
        const samples = [];
        let last = null;
        for (let trial = 0; trial < trialCount; trial += 1) {
          last = await render(providerCount, renderedProviderCount);
          samples.push(last.elapsed);
        }
        rows.push({
          providerCount,
          payerCount: 20,
          strategy,
          renderedProviderCount,
          cellCount: last?.cellCount ?? 0,
          elementCount: last?.elementCount ?? 0,
          timing: summarize(samples),
        });
      }
    }
    return rows;
  },
  { trialCount: trials },
);

await browser.close();

process.stdout.write(
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      environment: {
        browser: "Chromium headless",
        viewport: "1440x900",
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpuModel: os.cpus()[0]?.model ?? null,
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      method: {
        trials,
        note: "Optimistic DOM lower bound: one button and one span per matrix cell; the production MatrixCellPopover tree is heavier.",
        timingIncludes: "DOM construction, append, forced layout, and two animation frames",
      },
      measurements: result,
    },
    null,
    2,
  )}\n`,
);
