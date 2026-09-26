import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

/**
 * A download cut short earlier (its `.downloading` temp and `.resume`
 * sidecar still in OPFS) continues with a Range request in the real write
 * worker and is completed from the server's 206 reply, not re-fetched.
 * The server is a route stub serving a 20-byte file under a strong etag.
 */

const FULL = "0123456789abcdefghij";
const KEPT = 8;
const ETAG = '"e2e-build-1"';

test("an interrupted chart download resumes where it stopped", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Chart Regions" }).click();
  const row = page.locator("[data-basemap-id]").first();
  const regionId = await row.getAttribute("data-basemap-id");
  const filename = `basemap-${regionId}.pmtiles`;

  const ranges: (string | null)[] = [];
  await page.route(`**/${filename}`, (route) => {
    const range = route.request().headers().range ?? null;
    // (The panel's update check HEADs downloaded files too.)
    if (route.request().method() === "GET") ranges.push(range);
    const start = range ? Number(range.match(/^bytes=(\d+)-$/)?.[1]) : 0;
    return route.fulfill({
      status: range ? 206 : 200,
      headers: {
        etag: ETAG,
        "content-type": "application/octet-stream",
        ...(range && {
          "content-range": `bytes ${start}-${FULL.length - 1}/${FULL.length}`,
        }),
      },
      body: FULL.slice(start),
    });
  });

  // What an earlier attempt left behind when the network dropped.
  await page.evaluate(
    async ({ filename, kept, etag, total }) => {
      const root = await navigator.storage.getDirectory();
      const write = async (name: string, data: string) => {
        const handle = await root.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
      };
      await write(`${filename}.downloading`, kept);
      await write(
        `${filename}.resume`,
        JSON.stringify({
          etag,
          bytes: kept.length,
          total,
          savedAt: Date.now(),
        }),
      );
    },
    { filename, kept: FULL.slice(0, KEPT), etag: ETAG, total: FULL.length },
  );

  await row.locator('button[title^="Download offline street basemap"]').click();
  await expect(row).toContainText("Downloaded", { timeout: 15000 });

  expect(ranges).toEqual([`bytes=${KEPT}-`]);
  const stored = await page.evaluate(async (filename) => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    const file = await (await root.getFileHandle(filename)).getFile();
    return { content: await file.text(), names };
  }, filename);
  expect(stored.content).toBe(FULL);
  expect(stored.names).not.toContain(`${filename}.downloading`);
  expect(stored.names).not.toContain(`${filename}.resume`);
});
