import { Platform } from 'react-native';
import { supabase } from './supabase';

export const PRO_ENTITLEMENT_ID = 'OurSpark Pro';

type CustomerInfo = {
  entitlements: { active: Record<string, unknown> };
  allPurchasedProductIdentifiers?: string[];
};

type PurchasesPackage = {
  product: { identifier: string; priceString: string };
};

export type PendingIapPurchase = {
  productId: string;
  coupleId: string;
  userId: string;
};

const packagesByProductId = new Map<string, PurchasesPackage>();

/** Set by App.tsx after constants are defined. */
let proProductIds: string[] = [];
let packProductIdToPackName: Record<string, string> = {};

const PURCHASES_UNAVAILABLE = 'Purchases not available';

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

export function isPurchaseCancelledError(_err: unknown): boolean {
  return false;
}

/** Purchases temporarily unavailable — RevenueCat removed. */
export async function fetchOfferingsAndCache(): Promise<void> {
  throw new Error(PURCHASES_UNAVAILABLE);
}

/** Purchases temporarily unavailable — RevenueCat removed. */
export async function purchaseProductById(
  _productId: string,
  _coupleId: string,
  _userId: string
): Promise<CustomerInfo> {
  throw new Error(PURCHASES_UNAVAILABLE);
}

/** Purchases temporarily unavailable — RevenueCat removed. */
export async function restoreIapPurchases(
  _coupleId: string,
  _userId: string,
  _proProductIds: string[] = proProductIds,
  _packProductIdToPackName: Record<string, string> = packProductIdToPackName
): Promise<{ restoredPro: boolean; restoredPackCount: number }> {
  throw new Error(PURCHASES_UNAVAILABLE);
}

/** Purchases temporarily unavailable — RevenueCat removed. */
export async function syncProFromCustomerInfo(_coupleId: string): Promise<boolean | null> {
  throw new Error(PURCHASES_UNAVAILABLE);
}

/** @deprecated Prefer syncProFromCustomerInfo — kept for call-site compatibility. */
export async function syncProFromPurchaseHistory(
  coupleId: string,
  _proProductIds: string[]
): Promise<boolean | null> {
  return syncProFromCustomerInfo(coupleId);
}

export async function setCouplePro(coupleId: string, isPro: boolean): Promise<void> {
  const { error } = await supabase.from('couples').update({ is_pro: isPro }).eq('id', coupleId);
  if (error) {
    throw new Error(error.message);
  }
}
