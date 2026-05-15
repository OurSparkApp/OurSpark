import * as InAppPurchases from 'expo-in-app-purchases';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type IapProductId = string;

export type PendingIapPurchase = {
  productId: string;
  coupleId: string;
  userId: string;
};

let connected = false;
let listenerRegistered = false;
const productsById = new Map<string, InAppPurchases.IAPItemDetails>();

let pendingPurchase: PendingIapPurchase | null = null;
let onPurchaseSettled: ((result: { success: boolean; productId: string; message: string }) => void) | null =
  null;

export function getIapProductDetails(productId: string): InAppPurchases.IAPItemDetails | undefined {
  return productsById.get(productId);
}

export function getIapFormattedPrice(productId: string, fallback = ''): string {
  return productsById.get(productId)?.price ?? fallback;
}

export function setPendingIapPurchase(ctx: PendingIapPurchase | null): void {
  pendingPurchase = ctx;
}

export function setIapPurchaseSettledHandler(
  handler: ((result: { success: boolean; productId: string; message: string }) => void) | null
): void {
  onPurchaseSettled = handler;
}

export function isIapSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function connectAndLoadProducts(productIds: string[]): Promise<void> {
  if (!isIapSupported() || productIds.length === 0) {
    return;
  }

  if (!connected) {
    await InAppPurchases.connectAsync();
    connected = true;
  }

  if (!listenerRegistered) {
    InAppPurchases.setPurchaseListener(({ responseCode, results, errorCode }) => {
      void (async () => {
        if (responseCode === InAppPurchases.IAPResponseCode.USER_CANCELED) {
          onPurchaseSettled?.({
            success: false,
            productId: pendingPurchase?.productId ?? '',
            message: 'Purchase canceled',
          });
          pendingPurchase = null;
          return;
        }

        if (responseCode !== InAppPurchases.IAPResponseCode.OK || !results?.length) {
          onPurchaseSettled?.({
            success: false,
            productId: pendingPurchase?.productId ?? '',
            message: `Purchase failed${errorCode != null ? ` (${errorCode})` : ''}`,
          });
          pendingPurchase = null;
          return;
        }

        for (const purchase of results) {
          if (purchase.purchaseState !== InAppPurchases.InAppPurchaseState.PURCHASED) {
            continue;
          }
          if (purchase.acknowledged) {
            continue;
          }

          const ctx = pendingPurchase;
          try {
            await fulfillPurchase(purchase.productId, ctx?.coupleId ?? null, ctx?.userId ?? null);
            await InAppPurchases.finishTransactionAsync(purchase, true);
            onPurchaseSettled?.({
              success: true,
              productId: purchase.productId,
              message: 'Purchase successful',
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not complete purchase';
            onPurchaseSettled?.({ success: false, productId: purchase.productId, message });
          }
        }
        pendingPurchase = null;
      })();
    });
    listenerRegistered = true;
  }

  const { responseCode, results } = await InAppPurchases.getProductsAsync(productIds);
  if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
    productsById.clear();
    for (const item of results) {
      productsById.set(item.productId, item);
    }
  }
}

export async function startIapPurchase(
  productId: string,
  coupleId: string,
  userId: string
): Promise<void> {
  if (!isIapSupported()) {
    throw new Error('In-app purchases are only available on iOS and Android.');
  }
  if (!connected) {
    throw new Error('Store is not ready yet. Please try again in a moment.');
  }
  if (!productsById.has(productId)) {
    throw new Error('This product is not available in the App Store yet.');
  }

  pendingPurchase = { productId, coupleId, userId };
  await InAppPurchases.purchaseItemAsync(productId);
}

export async function restoreIapPurchases(
  coupleId: string,
  userId: string,
  proProductIds: string[],
  packProductIdToPackName: Record<string, string>
): Promise<{ restoredPro: boolean; restoredPackCount: number }> {
  if (!isIapSupported()) {
    return { restoredPro: false, restoredPackCount: 0 };
  }
  if (!connected) {
    await InAppPurchases.connectAsync();
    connected = true;
  }

  const { responseCode, results } = await InAppPurchases.getPurchaseHistoryAsync();
  if (responseCode !== InAppPurchases.IAPResponseCode.OK || !results?.length) {
    return { restoredPro: false, restoredPackCount: 0 };
  }

  let restoredPro = false;
  let restoredPackCount = 0;

  for (const purchase of results) {
    if (purchase.purchaseState !== InAppPurchases.InAppPurchaseState.PURCHASED) {
      continue;
    }

    if (proProductIds.includes(purchase.productId)) {
      await setCouplePro(coupleId, true);
      restoredPro = true;
      if (!purchase.acknowledged) {
        await InAppPurchases.finishTransactionAsync(purchase, false);
      }
      continue;
    }

    const packName = packProductIdToPackName[purchase.productId];
    if (packName) {
      const unlocked = await unlockPackForCouple(coupleId, userId, packName);
      if (unlocked) {
        restoredPackCount += 1;
      }
      if (!purchase.acknowledged) {
        await InAppPurchases.finishTransactionAsync(purchase, true);
      }
    }
  }

  return { restoredPro, restoredPackCount };
}

/** Syncs `couples.is_pro` from App Store / Play purchase history. No-op if the store query fails. */
export async function syncProFromPurchaseHistory(
  coupleId: string,
  proProductIds: string[]
): Promise<boolean | null> {
  if (!isIapSupported() || !connected) {
    return null;
  }

  const { responseCode, results } = await InAppPurchases.getPurchaseHistoryAsync();
  if (responseCode !== InAppPurchases.IAPResponseCode.OK) {
    return null;
  }

  const hasActivePro = (results ?? []).some(
    (p) =>
      proProductIds.includes(p.productId) &&
      p.purchaseState === InAppPurchases.InAppPurchaseState.PURCHASED
  );

  await setCouplePro(coupleId, hasActivePro);
  return hasActivePro;
}

async function fulfillPurchase(
  productId: string,
  coupleId: string | null,
  userId: string | null
): Promise<void> {
  if (!coupleId || !userId) {
    throw new Error('Missing couple context for this purchase.');
  }

  if (isProProductId(productId)) {
    await setCouplePro(coupleId, true);
    return;
  }

  const packName = getPackNameForProductId(productId);
  if (!packName) {
    throw new Error('Unknown pack product.');
  }

  const unlocked = await unlockPackForCouple(coupleId, userId, packName);
  if (!unlocked) {
    throw new Error('Could not unlock pack for your couple.');
  }
}

export async function setCouplePro(coupleId: string, isPro: boolean): Promise<void> {
  const { error } = await supabase.from('couples').update({ is_pro: isPro }).eq('id', coupleId);
  if (error) {
    throw new Error(error.message);
  }
}

async function unlockPackForCouple(
  coupleId: string,
  userId: string,
  packName: string
): Promise<boolean> {
  const { data: packRow } = await supabase.from('packs').select('id').eq('name', packName).maybeSingle();
  if (!packRow?.id) {
    return false;
  }

  const packId = String(packRow.id);
  const { data: existing } = await supabase
    .from('couple_packs')
    .select('id, status')
    .eq('couple_id', coupleId)
    .eq('pack_id', packId)
    .maybeSingle();

  let couplePackId: string | null = existing?.id != null ? String(existing.id) : null;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('couple_packs')
      .update({
        status: 'active',
        current_day: 1,
        activated_by: userId,
        activated_at: new Date().toISOString(),
        paused_at: null,
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (error) {
      return false;
    }
    couplePackId = data?.id != null ? String(data.id) : couplePackId;
  } else {
    const { data, error } = await supabase
      .from('couple_packs')
      .insert({
        couple_id: coupleId,
        pack_id: packId,
        status: 'active',
        current_day: 1,
        activated_by: userId,
        activated_at: new Date().toISOString(),
        paused_at: null,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      return false;
    }
    couplePackId = data?.id != null ? String(data.id) : null;
  }

  if (couplePackId) {
    await supabase.from('couples').update({ active_pack_id: couplePackId }).eq('id', coupleId);
  }

  return Boolean(couplePackId);
}

/** Set by App.tsx after constants are defined. */
let proProductIds: string[] = [];
let packProductIdToPackName: Record<string, string> = {};

export function configureIapProductMaps(
  proIds: string[],
  packIdToName: Record<string, string>
): void {
  proProductIds = proIds;
  packProductIdToPackName = packIdToName;
}

export function isProProductId(productId: string): boolean {
  return proProductIds.includes(productId);
}

function getPackNameForProductId(productId: string): string | undefined {
  return packProductIdToPackName[productId];
}

export function getPackProductIdToNameMap(): Record<string, string> {
  return packProductIdToPackName;
}
