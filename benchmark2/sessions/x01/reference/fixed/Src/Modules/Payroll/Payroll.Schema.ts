import { z } from "zod";
import { PageQuery } from "../../Lib/Pagination";

export const MonthText = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

export const RunBody = z.object({ Month: MonthText });

export const MonthQuery = z.object({ Month: MonthText });

export const PayslipsQuery = PageQuery.extend({ Month: MonthText });
