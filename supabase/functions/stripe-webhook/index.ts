import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey);
const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !webhookSecret) {
    return jsonResponse(500, { error: "Missing required environment variables" });
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    return jsonResponse(400, { error: "Missing Stripe-Signature header" });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return jsonResponse(400, { error: "Invalid signature", details: message });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata ?? {};
        const type = metadata.type;
        const coupleId = metadata.couple_id;
        const userId = metadata.user_id;
        const priceId = metadata.price_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
        const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;

        console.log("checkout.session.completed", {
          customerEmail,
          type,
          coupleId,
          userId,
          priceId,
        });

        if (type === "subscription" && coupleId) {
          await supabase
            .from("couples")
            .update({
              is_pro: true,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
            })
            .eq("id", coupleId);
        }

        if (type === "pack" && coupleId && userId && priceId) {
          const { data: pack } = await supabase
            .from("packs")
            .select("id")
            .eq("stripe_price_id", priceId)
            .maybeSingle();

          if (pack?.id) {
            await supabase.from("couple_packs").upsert(
              {
                couple_id: coupleId,
                pack_id: String(pack.id),
                status: "owned",
                activated_by: userId,
              },
              { onConflict: "couple_id,pack_id", ignoreDuplicates: true },
            );
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        if (customerId) {
          await supabase
            .from("couples")
            .update({ is_pro: false, stripe_subscription_id: null })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
        const status = subscription.status;
        const isPro = status === "active";
        if (customerId && (status === "active" || status === "canceled" || status === "past_due")) {
          await supabase
            .from("couples")
            .update({
              is_pro: isPro,
              stripe_subscription_id: isPro ? subscription.id : null,
            })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return jsonResponse(200, { received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handling failed";
    return jsonResponse(500, { error: message });
  }
});
