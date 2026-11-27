import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as Schema from "./Schema";

export const QueryStats = {
  Count: 0,
  Statements: [] as string[],
  Reset() {
    this.Count = 0;
    this.Statements = [];
  },
  Record(Sql: string) {
    this.Count++;
    this.Statements.push(Sql);
  },
};

function Instrument<T extends { query: Function; exec: Function }>(Target: T) {
  const Query = Target.query.bind(Target);
  const Exec = Target.exec.bind(Target);
  (Target as any).query = (Sql: string, ...Rest: unknown[]) => {
    QueryStats.Record(Sql);
    return Query(Sql, ...Rest);
  };
  (Target as any).exec = (Sql: string, ...Rest: unknown[]) => {
    QueryStats.Record(Sql);
    return Exec(Sql, ...Rest);
  };
}

export const Client = new PGlite();
Instrument(Client);
const Transaction = Client.transaction.bind(Client);
(Client as any).transaction = (Fn: (Tx: any) => Promise<unknown>) =>
  Transaction((Tx: any) => {
    Instrument(Tx);
    return Fn(Tx);
  });

export const Db = drizzle(Client, { schema: Schema });
export type Database = typeof Db;
export type Transaction = Parameters<Parameters<typeof Db.transaction>[0]>[0];
