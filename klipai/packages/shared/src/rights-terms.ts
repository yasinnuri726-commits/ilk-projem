// Yol: klipai/packages/shared/src/rights-terms.ts
//
// Kullanıcıya gösterilen ve kabulü kayıt altına alınan hak beyanı metni.
// Metin değişirse `version` artırılır; API eski sürümle gelen beyanı reddeder.

export const RIGHTS_BASES = ['OWN_CONTENT', 'LICENSED', 'PUBLIC_DOMAIN', 'PERMITTED'] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];

/** Bu dayanaklarda açıklama (lisans / izin kaynağı) zorunludur. */
export const RIGHTS_NOTE_REQUIRED: readonly RightsBasis[] = ['LICENSED', 'PERMITTED'];

export const RIGHTS_TERMS = {
  version: '2026-11-01',
  tr:
    'Bu videoyu işlemek ve ondan üretilen klipleri yayınlamak için gerekli tüm haklara sahip olduğumu ' +
    'beyan ederim: içerik bana aittir, lisanslıdır, kamu malıdır ya da hak sahibinden izin aldım. ' +
    'Beyanımın doğru olmaması hâlinde doğacak tüm hukuki sorumluluğun bana ait olduğunu, KlipAI\'nin ' +
    'bu beyanı tarih, IP adresi ve cihaz bilgisiyle birlikte kayıt altına aldığını kabul ediyorum.',
  en:
    'I declare that I hold all rights required to process this video and publish clips made from it: ' +
    'the content is mine, licensed, in the public domain, or I have permission from the rights holder. ' +
    'I accept that I bear all legal responsibility if this declaration is untrue, and that KlipAI ' +
    'records this declaration together with the date, IP address and device information.',
} as const;
