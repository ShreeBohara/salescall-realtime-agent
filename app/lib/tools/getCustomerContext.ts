import { tool } from "@openai/agents-realtime";
import { z } from "zod";
import { findCustomer, CUSTOMERS } from "../data/customers";
import { getSelectedCustomer } from "../store/customerStore";

const GetCustomerContextParams = z.object({
  customer_name: z
    .string()
    .nullable()
    .describe(
      "The customer to look up. If null or empty, returns the currently-selected customer on this call. Use the rep's words — fuzzy match handles aliases and case."
    ),
  fields: z
    .array(
      z.enum([
        "summary",
        "contact",
        "deal",
        "meddic",
        "objections",
        "activity",
      ])
    )
    .describe(
      "Which field groups to include. Use ['summary'] for a quick overview; specific fields for drill-down questions. Empty array returns everything."
    ),
});

export const getCustomerContext = tool({
  name: "get_customer_context",
  description:
    "Look up structured context about a customer: contact, deal stage, MEDDIC qualification, past objections, and recent activity. Use this when the rep asks about a customer (e.g. 'what was their last objection?', 'who's the champion at Acme?', 'remind me where we are with Globex'). If customer_name is null, returns the currently-selected customer on this call.",
  parameters: GetCustomerContextParams,
  execute: async (input) => {
    const query = input.customer_name?.trim();

    const customer = query ? findCustomer(query) : getSelectedCustomer();

    if (!customer) {
      return JSON.stringify({
        ok: false,
        error: "customer_not_found",
        message: `No customer matched "${query}". Ask the rep to clarify or pick from the known customers.`,
        available: CUSTOMERS.map((c) => ({ id: c.id, name: c.name })),
      });
    }

    const requested: Set<string> | null =
      input.fields.length > 0 ? new Set<string>(input.fields) : null;
    const want = (field: string) => requested === null || requested.has(field);

    const out: Record<string, unknown> = {
      ok: true,
      id: customer.id,
      name: customer.name,
    };

    if (want("summary")) {
      out.summary = {
        industry: customer.industry,
        dealStage: customer.dealStage,
        dealSize: customer.dealSize,
        lastCallDate: customer.lastCallDate,
        openTickets: customer.openTickets,
        primaryContact: `${customer.contact.name}, ${customer.contact.title}`,
      };
    }

    if (want("contact")) {
      out.contact = customer.contact;
    }

    if (want("deal")) {
      out.deal = {
        stage: customer.dealStage,
        size: customer.dealSize,
        champion: customer.meddic.champion,
      };
    }

    if (want("meddic")) {
      out.meddic = customer.meddic;
    }

    if (want("objections")) {
      out.pastObjections = customer.pastObjections;
    }

    if (want("activity")) {
      out.recentActivity = customer.recentActivity;
    }

    console.log("[tool:get_customer_context] called", {
      queryIn: query ?? null,
      matched: customer.id,
      fields: input.fields,
    });

    return JSON.stringify(out);
  },
});
