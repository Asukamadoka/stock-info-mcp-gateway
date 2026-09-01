// @ts-nocheck -- reverse-synced ESZip runtime snapshot; canonical typed source will replace this snapshot after v0.1 bootstrap.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL"), {
  prepare: false,
  max: 1
});
const VERSION = "1.0.0", PROTOCOL = "2025-11-25", BASE = "https://ai.zhangle.com/edge/entry/gate";
let cache = new Map();
async function sec(n) {
  if (cache.has(n)) return cache.get(n);
  const r = await sql`select decrypted_secret from vault.decrypted_secrets where name=${n} limit 1`;
  const v = String(r?.[0]?.decrypted_secret || "");
  if (!v) throw new Error(`missing secret ${n}`);
  cache.set(n, v);
  return v;
}
function jr(id, result, status = 200) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function je(id, code, message, data, status = 200) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...data === undefined ? {} : {
        data
      }
    }
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function wrap(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data)
      }
    ],
    structuredContent: {
      data,
      status: 200,
      message: ""
    }
  };
}
async function post(path, skillCode, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: {
      apiKey: await sec("ht_apikey"),
      skillCode,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTSC HTTP ${r.status}: ${txt.slice(0, 1000)}`);
  try {
    return JSON.parse(txt);
  } catch  {
    throw new Error(`HTSC non-JSON: ${txt.slice(0, 1000)}`);
  }
}
const defs = {
  ht_query_indicator: {
    path: "/api/finAnalysis/queryIndicator",
    code: "mx_1779108020995"
  },
  ht_diagnosis_stock: {
    path: "/api/finAnalysis/diagnosisStock",
    code: "mx_1779096185749"
  },
  ht_market_insight: {
    path: "/api/finAnalysis/marketInsight",
    code: "mx_1779096185749"
  },
  ht_select_stock: {
    path: "/api/finAnalysis/selectStock",
    code: "mx_select-stock"
  },
  ht_search_stock: {
    path: "/api/simSkills/searchStock",
    code: "mx_1778741794549"
  },
  ht_get_quote: {
    path: "/api/simSkills/getQuote",
    code: "mx_1778741794549"
  },
  ht_get_account_balance: {
    path: "/api/simSkills/getAccountBalance",
    code: "mx_1778741794549"
  },
  ht_get_positions: {
    path: "/api/simSkills/getPositions",
    code: "mx_1778741794549"
  },
  ht_submit_order: {
    path: "/api/simSkills/submitOrder",
    code: "mx_1778741794549"
  },
  ht_cancel_order: {
    path: "/api/simSkills/cancelOrder",
    code: "mx_1778741794549"
  },
  ht_cancel_all_pending_orders: {
    path: "/api/simSkills/cancelAllPendingOrders",
    code: "mx_1778741794549"
  },
  ht_list_pending_orders: {
    path: "/api/simSkills/listPendingOrders",
    code: "mx_1778741794549"
  },
  ht_list_trade_history: {
    path: "/api/simSkills/listTradeHistory",
    code: "mx_1778741794549"
  },
  ht_add_watchlist: {
    path: "/api/finAnalysis/addWatchlist",
    code: "mx_watchlist-management"
  },
  ht_get_watchlist: {
    path: "/api/finAnalysis/getWatchlist",
    code: "mx_watchlist-management"
  }
};
const q = {
  type: "object",
  properties: {
    query: {
      type: "string"
    }
  },
  required: [
    "query"
  ],
  additionalProperties: false
};
const TOOLS = [
  {
    name: "ht_query_indicator",
    description: "AI涨乐/华泰：金融指标与行情综合检索",
    inputSchema: q
  },
  {
    name: "ht_diagnosis_stock",
    description: "AI涨乐/华泰：个股/ETF/板块分析诊断",
    inputSchema: q
  },
  {
    name: "ht_market_insight",
    description: "AI涨乐/华泰：市场洞察、资讯、板块和多标的分析",
    inputSchema: q
  },
  {
    name: "ht_select_stock",
    description: "AI涨乐/华泰：自然语言条件选股",
    inputSchema: q
  },
  {
    name: "ht_search_stock",
    description: "华泰模拟盘：按名称/代码/拼音搜索A股",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string"
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 30
        }
      },
      required: [
        "query"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_get_quote",
    description: "华泰模拟盘：A股实时行情（涨跌停/买卖一档）",
    inputSchema: {
      type: "object",
      properties: {
        stockCode: {
          type: "string"
        },
        exchange: {
          type: "string",
          enum: [
            "SH",
            "SZ",
            "BJ"
          ]
        }
      },
      required: [
        "stockCode",
        "exchange"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_get_account_balance",
    description: "华泰模拟盘：账户资金总览（只读）",
    inputSchema: {
      type: "object",
      additionalProperties: false
    }
  },
  {
    name: "ht_get_positions",
    description: "华泰模拟盘：持仓明细（只读）",
    inputSchema: {
      type: "object",
      additionalProperties: false
    }
  },
  {
    name: "ht_submit_order",
    description: "华泰模拟盘：提交模拟买卖委托（会改变模拟账户）",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: [
            "buy",
            "sell"
          ]
        },
        stockCode: {
          type: "string"
        },
        exchange: {
          type: "string",
          enum: [
            "SH",
            "SZ",
            "BJ"
          ]
        },
        quantity: {
          type: "integer",
          minimum: 1
        },
        orderType: {
          type: "string",
          enum: [
            "limit",
            "market"
          ]
        },
        price: {
          type: "number"
        }
      },
      required: [
        "direction",
        "stockCode",
        "exchange",
        "quantity",
        "orderType"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_cancel_order",
    description: "华泰模拟盘：按单号撤单（会改变模拟账户）",
    inputSchema: {
      type: "object",
      properties: {
        orderId: {
          type: "string"
        }
      },
      required: [
        "orderId"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_cancel_all_pending_orders",
    description: "华泰模拟盘：批量撤销未成交委托（会改变模拟账户）",
    inputSchema: {
      type: "object",
      properties: {
        stockCode: {
          type: "string"
        },
        exchange: {
          type: "string",
          enum: [
            "SH",
            "SZ",
            "BJ"
          ]
        },
        direction: {
          type: "string",
          enum: [
            "buy",
            "sell"
          ]
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ht_list_pending_orders",
    description: "华泰模拟盘：查询当日未成交/部分成交委托",
    inputSchema: {
      type: "object",
      properties: {
        stockCode: {
          type: "string"
        },
        exchange: {
          type: "string",
          enum: [
            "SH",
            "SZ",
            "BJ"
          ]
        },
        direction: {
          type: "string",
          enum: [
            "buy",
            "sell"
          ]
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ht_list_trade_history",
    description: "华泰模拟盘：查询历史成交",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string"
        },
        endDate: {
          type: "string"
        },
        stockCode: {
          type: "string"
        },
        exchange: {
          type: "string",
          enum: [
            "SH",
            "SZ",
            "BJ"
          ]
        },
        direction: {
          type: "string",
          enum: [
            "buy",
            "sell"
          ]
        }
      },
      required: [
        "startDate",
        "endDate"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_add_watchlist",
    description: "AI涨乐/华泰：添加自选股（会改变自选列表）",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string"
        },
        group: {
          type: "string"
        }
      },
      required: [
        "query"
      ],
      additionalProperties: false
    }
  },
  {
    name: "ht_get_watchlist",
    description: "AI涨乐/华泰：查询自选股列表",
    inputSchema: q
  }
];
Deno.serve(async (req)=>{
  if (req.method === "GET") return new Response(JSON.stringify({
    name: "stock-info-htsc",
    version: VERSION,
    status: "ok"
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
  if (req.method !== "POST") return new Response("Method Not Allowed", {
    status: 405
  });
  try {
    if ((req.headers.get("authorization") || "") !== `Bearer ${await sec("jin10_bearer_token")}`) return je(null, -32001, "Unauthorized", undefined, 401);
    const b = await req.json(), id = b?.id, m = b?.method, p = b?.params || {};
    if (m === "initialize") return jr(id, {
      protocolVersion: PROTOCOL,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "stock-info-htsc",
        version: VERSION
      }
    });
    if (m === "notifications/initialized") return new Response(null, {
      status: 202
    });
    if (m === "ping") return jr(id, {});
    if (m === "tools/list") return jr(id, {
      tools: TOOLS
    });
    if (m === "tools/call") {
      const n = String(p?.name || ""), a = p?.arguments || {}, d = defs[n];
      if (!d) return je(id, -32601, `unknown tool ${n}`);
      return jr(id, wrap(await post(d.path, d.code, a)));
    }
    return je(id, -32601, `Method not found: ${m}`);
  } catch (e) {
    return je(null, -32603, "Internal error", e instanceof Error ? e.message : String(e), 500);
  }
});
