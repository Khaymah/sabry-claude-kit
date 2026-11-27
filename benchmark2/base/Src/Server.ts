import { App } from "./App";
import { Client } from "./Database/Db";
import { Migrate } from "./Database/Migrations";

await Migrate(Client);
const Port = 3000;
Bun.serve({ port: Port, fetch: App.fetch });
console.log(`Listening on :${Port}`);
