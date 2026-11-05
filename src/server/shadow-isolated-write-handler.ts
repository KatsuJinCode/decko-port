import { LocalSqliteDriver } from "./drivers/local-sqlite.js";
import { FetchEngine } from "../card/fetch.js";
import { LocalAttachmentStore } from "../card/attachments/attachment-store.js";
import { handleWriteRequest, type WriteRouteRequest, type WriteRouteResponse } from "./write-routes.js";

export interface IsolatedWriteHandler {
  handle(req: WriteRouteRequest): Promise<WriteRouteResponse | null>;
  close(): void;
}

export async function createIsolatedWriteHandler(opts: {
  dbPath: string;
  filesDir: string;
}): Promise<IsolatedWriteHandler> {
  const driver = new LocalSqliteDriver({ path: opts.dbPath });
  const fetcher = new FetchEngine(driver);
  const attachmentStore = new LocalAttachmentStore(opts.filesDir);
  return {
    handle: (req) => handleWriteRequest({ driver, fetcher, attachmentStore }, req),
    close: () => driver.close(),
  };
}
