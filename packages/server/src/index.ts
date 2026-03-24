import { createAppServer } from "./server.js";

const { server, config } = createAppServer();

server.listen(config.port, () => {
  console.log(`Poker server listening on http://localhost:${config.port}`);
});
