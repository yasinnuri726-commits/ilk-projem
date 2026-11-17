import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { api } from '../api/client';
import type { SubscriptionInfo, User } from '../api/types';
import { RC_ANDROID_KEY, RC_IOS_KEY } from '../config';

let configured = false;

/** RevenueCat'i kullanıcının sunucudaki `revenueCatId` değeriyle yapılandırır (webhook eşlemesi bu kimlikle yapılır). */
export async function initPurchases(user: User): Promise<boolean> {
  const key = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
  if (!key) return false;
  try {
    if (!configured) {
      Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey: key, appUserID: user.revenueCatId });
      configured = true;
    } else {
      await Purchases.logIn(user.revenueCatId);
    }
    return true;
  } catch {
    return false;
  }
}

export interface Offer { plan: 'PRO' | 'AGENCY'; pkg: PurchasesPackage; price: string }

export async function loadOffers(): Promise<Offer[]> {
  const offerings = await Purchases.getOfferings();
  const pkgs = offerings.current?.availablePackages ?? [];
  const out: Offer[] = [];
  for (const pkg of pkgs) {
    const id = `${pkg.identifier} ${pkg.product.identifier}`.toLowerCase();
    const plan = id.includes('agency') || id.includes('ajans') ? 'AGENCY' : id.includes('pro') ? 'PRO' : null;
    if (plan) out.push({ plan, pkg, price: pkg.product.priceString });
  }
  return out;
}

/** Satın alımdan sonra webhook gelmeden önce sunucu RevenueCat'ten durumu çeker. */
export async function buy(pkg: PurchasesPackage): Promise<SubscriptionInfo> {
  await Purchases.purchasePackage(pkg);
  return api<SubscriptionInfo>('/subscription/sync', { method: 'POST' });
}
export async function restore(): Promise<SubscriptionInfo> {
  await Purchases.restorePurchases();
  return api<SubscriptionInfo>('/subscription/sync', { method: 'POST' });
}
export const isCancelled = (e: unknown) => (e as { userCancelled?: boolean })?.userCancelled === true;
