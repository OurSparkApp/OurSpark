import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';

export const PRO_ENTITLEMENT_ID = 'OurSpark Pro';

/** Matches RevenueCat PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR without a runtime import. */
const PURCHASE_CANCELLED_ERROR_CODE = '1';

export type PendingIapPurchase = {
  productId: string;
  coupleId: string;
  userId: string;
};

const packagesByProductId = new Map<string, PurchasesPackage>();

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

export function isIapSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function getPackageForProductId(productId: string): PurchasesPackage | undefined {
  return packagesByProductId.get(productId);
}

export function getIapFormattedPrice(productId: string, fallback = ''): string {
  return packagesByProductId.get(productId)?.product.priceString ?? fallback;
}

export function isProProductId(productId: string): boolean {
  return proProductIds.includes(productId);
}

export function getPackProductIdToNameMap(): Record<string, string> {
  return packProductIdToPackName;
}

export function hasActiveProEntitlement(customerInfo: CustomerInfo): boolean {
  return Boolean(customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]);
}

export function isPurchaseCancelledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const maybe = err as { code?: string; userCancelled?: boolean | null };
  if (maybe.userCancelled === true) {
    return true;
  }
  return maybe.code === PURCHASE_CANCELLED_ERROR_CODE;
}

/** Fetch RevenueCat offerings and cache packages by store product ID. */
export async function fetchOfferingsAndCache(): Promise<void> {
  if (Platform.OS !== 'ios' || Platform.isPad) return;
  const { default: Purchases } = await import('react-native-purchases');

  if (!isIapSupported()) {
    return;
  }

  const offerings = await Purchases.getOfferings();
  packagesByProductId.clear();

  const packages: PurchasesPackage[] = [];
  if (offerings.current?.availablePackages?.length) {
    packages.push(...offerings.current.availablePackages);
  }
  for (const offering of Object.values(offerings.all ?? {})) {
    if (offering?.availablePackages?.length) {
      packages.push(...offering.availablePackages);
    }
  }

  for (const pkg of packages) {
    packagesByProductId.set(pkg.product.identifier, pkg);
  }
}

/**
 * Purchase a product via its RevenueCat package, then fulfill in Supabase.
 * Throws on genuine errors; callers should treat cancel via isPurchaseCancelledError.
 */
export async function purchaseProductById(
  productId: string,
  coupleId: string,
  userId: string
): Promise<CustomerInfo> {
  if (Platform.OS !== 'ios' || Platform.isPad) {
    throw new Error('In-app purchases are only available on iOS and Android.');
  }
  const { default: Purchases } = await import('react-native-purchases');

  if (!isIapSupported()) {
    throw new Error('In-app purchases are only available on iOS and Android.');
  }

  const aPackage = packagesByProductId.get(productId);
  if (!aPackage) {
    throw new Error('This product is not available yet. Please try again in a moment.');
  }

  const { customerInfo } = await Purchases.purchasePackage(aPackage);
  await fulfillPurchase(productId, coupleId, userId, customerInfo);
  return customerInfo;
}

export async function restoreIapPurchases(
  coupleId: string,
  userId: string,
  _proProductIds: string[] = proProductIds,
  _packProductIdToPackName: Record<string, string> = packProductIdToPackName
): Promise<{ restoredPro: boolean; restoredPackCount: number }> {
  if (Platform.OS !== 'ios' || Platform.isPad) return { restoredPro: false, restoredPackCount: 0 };
  const { default: Purchases } = await import('react-native-purchases');

  if (!isIapSupported()) {
    return { restoredPro: false, restoredPackCount: 0 };
  }

  const customerInfo = await Purchases.restorePurchases();
  return unlockFromCustomerInfo(customerInfo, coupleId, userId);
}

/** Sync `couples.is_pro` from RevenueCat entitlements. */
export async function syncProFromCustomerInfo(coupleId: string): Promise<boolean | null> {
  if (Platform.OS !== 'ios' || Platform.isPad) return null;
  const { default: Purchases } = await import('react-native-purchases');

  if (!isIapSupported()) {
    return null;
  }

  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const isPro = hasActiveProEntitlement(customerInfo);
    await setCouplePro(coupleId, isPro);
    return isPro;
  } catch {
    return null;
  }
}

/** @deprecated Prefer syncProFromCustomerInfo — kept for call-site compatibility. */
export async function syncProFromPurchaseHistory(
  coupleId: string,
  _proProductIds: string[]
): Promise<boolean | null> {
  return syncProFromCustomerInfo(coupleId);
}

async function unlockFromCustomerInfo(
  customerInfo: CustomerInfo,
  coupleId: string,
  userId: string
): Promise<{ restoredPro: boolean; restoredPackCount: number }> {
  let restoredPro = false;
  let restoredPackCount = 0;

  if (hasActiveProEntitlement(customerInfo)) {
    await setCouplePro(coupleId, true);
    restoredPro = true;
  }

  const purchasedIds = new Set(customerInfo.allPurchasedProductIdentifiers ?? []);
  for (const productId of purchasedIds) {
    if (proProductIds.includes(productId)) {
      if (!restoredPro) {
        await setCouplePro(coupleId, true);
        restoredPro = true;
      }
      continue;
    }

    const packName = packProductIdToPackName[productId];
    if (packName) {
      const unlocked = await unlockPackForCouple(coupleId, userId, packName);
      if (unlocked) {
        restoredPackCount += 1;
      }
    }
  }

  return { restoredPro, restoredPackCount };
}

async function fulfillPurchase(
  productId: string,
  coupleId: string,
  userId: string,
  customerInfo?: CustomerInfo
): Promise<void> {
  if (isProProductId(productId) || (customerInfo && hasActiveProEntitlement(customerInfo))) {
    await setCouplePro(coupleId, true);
    return;
  }

  const packName = packProductIdToPackName[productId];
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
