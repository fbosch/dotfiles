import net from "node:net";

const SOURCE = "user:opencode-session-title";
const AGENT = "opencode";
const APPLIES_TO_SOURCE = "herdr:opencode";
let reportSeq = Date.now() * 1000;

function reportSessionTitle(info) {
  if (info?.parentID || typeof info?.title !== "string" || info.title.trim() === "") {
    return Promise.resolve();
  }

  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) {
    return Promise.resolve();
  }

  reportSeq += 1;
  const request = {
    id: `${SOURCE}:${reportSeq}`,
    method: "pane.report_metadata",
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      applies_to_source: APPLIES_TO_SOURCE,
      seq: reportSeq,
      tokens: { opencode_session_title: info.title },
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    const finish = () => {
      client.destroy();
      resolve();
    };
    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

export const HerdrSessionTitlePlugin = async () => ({
  event: async ({ event }) => {
    if (event?.type === "session.created" || event?.type === "session.updated") {
      await reportSessionTitle(event.properties?.info);
    }
  },
});
