import dns from "node:dns";
import { createAppServer } from "./server.js";

dns.setDefaultResultOrder("ipv4first");

const { server, config } = createAppServer();

server.listen(config.port, () => {
  console.log(`Poker server listening on http://localhost:${config.port}`);
});
