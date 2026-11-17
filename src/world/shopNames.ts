import type { ShopType } from './signboards'

/*
 * The parts of made-up shop names, in Kannada and English. A board shows one
 * first word and one of its kind's words, laid on a blank board for the kind
 * (ShopFronts.tsx), so there are dozens of names for each kind of shop and the
 * same one is never up twice within a few hundred metres. Each name is one of the everyday words HSR's shops are named
 * after (a god, a goddess, a river, a hill, a blessing, or just "New" or
 * "Royal") with the usual words for its kind of shop. No real shop or brand is
 * meant: names this common belong to no one.
 *
 * The Kannada is transliterated from the English, as the rest of the boards
 * are. Worth a check by someone who reads Kannada before showing the game widely.
 */

export type Name = { kannada: string; english: string }

/** The first part of a name. */
export const PREFIXES: Name[] = [
  { english: 'Sri Lakshmi', kannada: 'ಶ್ರೀ ಲಕ್ಷ್ಮಿ' },
  { english: 'Sri Sai', kannada: 'ಶ್ರೀ ಸಾಯಿ' },
  { english: 'New', kannada: 'ನ್ಯೂ' },
  { english: 'Ganesh', kannada: 'ಗಣೇಶ್' },
  { english: 'Annapoorna', kannada: 'ಅನ್ನಪೂರ್ಣ' },
  { english: 'Balaji', kannada: 'ಬಾಲಾಜಿ' },
  { english: 'Sri Raghavendra', kannada: 'ಶ್ರೀ ರಾಘವೇಂದ್ರ' },
  { english: 'Manjunatha', kannada: 'ಮಂಜುನಾಥ' },
  { english: 'Kaveri', kannada: 'ಕಾವೇರಿ' },
  { english: 'Nandi', kannada: 'ನಂದಿ' },
  { english: 'Vinayaka', kannada: 'ವಿನಾಯಕ' },
  { english: 'Durga', kannada: 'ದುರ್ಗಾ' },
  { english: 'Chamundi', kannada: 'ಚಾಮುಂಡಿ' },
  { english: 'Vasavi', kannada: 'ವಾಸವಿ' },
  { english: 'Srinivasa', kannada: 'ಶ್ರೀನಿವಾಸ' },
  { english: 'Royal', kannada: 'ರಾಯಲ್' },
  { english: 'Star', kannada: 'ಸ್ಟಾರ್' },
  { english: 'Om Sai', kannada: 'ಓಂ ಸಾಯಿ' },
  { english: 'Friends', kannada: 'ಫ್ರೆಂಡ್ಸ್' },
  { english: 'Mahalakshmi', kannada: 'ಮಹಾಲಕ್ಷ್ಮಿ' },
  { english: 'Ashirwad', kannada: 'ಆಶೀರ್ವಾದ್' },
  { english: 'Sri Krishna', kannada: 'ಶ್ರೀ ಕೃಷ್ಣ' },
  { english: 'Sapthagiri', kannada: 'ಸಪ್ತಗಿರಿ' },
  { english: 'Kalpataru', kannada: 'ಕಲ್ಪತರು' },
  { english: 'Tirumala', kannada: 'ತಿರುಮಲ' },
  { english: 'Shanthi', kannada: 'ಶಾಂತಿ' },
  { english: 'Mysore', kannada: 'ಮೈಸೂರು' },
  { english: 'Sri Venkateshwara', kannada: 'ಶ್ರೀ ವೆಂಕಟೇಶ್ವರ' },
]

/** The words for each kind of shop that go after the first part. */
export const TYPE_WORDS: Record<ShopType, Name[]> = {
  kirana: [
    { english: 'Provision Stores', kannada: 'ಪ್ರಾವಿಷನ್ ಸ್ಟೋರ್ಸ್' },
    { english: 'Stores', kannada: 'ಸ್ಟೋರ್ಸ್' },
    { english: 'Kirana Stores', kannada: 'ಕಿರಾಣಿ ಸ್ಟೋರ್ಸ್' },
  ],
  darshini: [
    { english: 'Upahara', kannada: 'ಉಪಹಾರ' },
    { english: 'Darshini', kannada: 'ದರ್ಶಿನಿ' },
    { english: 'Bhavan', kannada: 'ಭವನ' },
    { english: 'Tiffin Centre', kannada: 'ಟಿಫಿನ್ ಸೆಂಟರ್' },
  ],
  chai: [
    { english: 'Tea Stall', kannada: 'ಟೀ ಸ್ಟಾಲ್' },
    { english: 'Tea Point', kannada: 'ಟೀ ಪಾಯಿಂಟ್' },
    { english: 'Tea & Snacks', kannada: 'ಟೀ & ಸ್ನ್ಯಾಕ್ಸ್' },
  ],
  bakery: [
    { english: 'Bakery', kannada: 'ಬೇಕರಿ' },
    { english: 'Iyengar Bakery', kannada: 'ಅಯ್ಯಂಗಾರ್ ಬೇಕರಿ' },
    { english: 'Sweets & Bakery', kannada: 'ಸ್ವೀಟ್ಸ್ & ಬೇಕರಿ' },
  ],
  pharmacy: [
    { english: 'Medicals', kannada: 'ಮೆಡಿಕಲ್ಸ್' },
    { english: 'Pharma', kannada: 'ಫಾರ್ಮಾ' },
    { english: 'Medical Stores', kannada: 'ಮೆಡಿಕಲ್ ಸ್ಟೋರ್ಸ್' },
  ],
  clothing: [
    { english: 'Fashions', kannada: 'ಫ್ಯಾಷನ್ಸ್' },
    { english: 'Textiles', kannada: 'ಟೆಕ್ಸ್‌ಟೈಲ್ಸ್' },
    { english: 'Silks', kannada: 'ಸಿಲ್ಕ್ಸ್' },
    { english: 'Collections', kannada: 'ಕಲೆಕ್ಷನ್ಸ್' },
  ],
  salon: [
    { english: 'Saloon', kannada: 'ಸಲೂನ್' },
    { english: 'Gents Parlour', kannada: 'ಜೆಂಟ್ಸ್ ಪಾರ್ಲರ್' },
    { english: 'Beauty Parlour', kannada: 'ಬ್ಯೂಟಿ ಪಾರ್ಲರ್' },
  ],
  jewellery: [
    { english: 'Jewellers', kannada: 'ಜ್ಯುವೆಲ್ಲರ್ಸ್' },
    { english: 'Gold Palace', kannada: 'ಗೋಲ್ಡ್ ಪ್ಯಾಲೇಸ್' },
    { english: 'Jewellery Mart', kannada: 'ಜ್ಯುವೆಲ್ಲರಿ ಮಾರ್ಟ್' },
  ],
  electronics: [
    { english: 'Electronics', kannada: 'ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್' },
    { english: 'Electricals', kannada: 'ಎಲೆಕ್ಟ್ರಿಕಲ್ಸ್' },
    { english: 'Digital', kannada: 'ಡಿಜಿಟಲ್' },
  ],
  supermarket: [
    { english: 'Super Market', kannada: 'ಸೂಪರ್ ಮಾರ್ಕೆಟ್' },
    { english: 'Mart', kannada: 'ಮಾರ್ಟ್' },
    { english: 'Fresh Mart', kannada: 'ಫ್ರೆಶ್ ಮಾರ್ಟ್' },
  ],
  chats: [
    { english: 'Chat Centre', kannada: 'ಚಾಟ್ ಸೆಂಟರ್' },
    { english: 'Chats', kannada: 'ಚಾಟ್ಸ್' },
    { english: 'Chaat Corner', kannada: 'ಚಾಟ್ ಕಾರ್ನರ್' },
  ],
  coffee: [
    { english: 'Coffee Bar', kannada: 'ಕಾಫಿ ಬಾರ್' },
    { english: 'Filter Coffee', kannada: 'ಫಿಲ್ಟರ್ ಕಾಫಿ' },
    { english: 'Coffee House', kannada: 'ಕಾಫಿ ಹೌಸ್' },
  ],
  mobiles: [
    { english: 'Mobiles', kannada: 'ಮೊಬೈಲ್ಸ್' },
    { english: 'Mobile World', kannada: 'ಮೊಬೈಲ್ ವರ್ಲ್ಡ್' },
    { english: 'Telecom', kannada: 'ಟೆಲಿಕಾಂ' },
  ],
  tailor: [
    { english: 'Tailors', kannada: 'ಟೈಲರ್ಸ್' },
    { english: 'Ladies Tailor', kannada: 'ಲೇಡೀಸ್ ಟೈಲರ್' },
    { english: 'Stitching Centre', kannada: 'ಸ್ಟಿಚಿಂಗ್ ಸೆಂಟರ್' },
  ],
  hardware: [
    { english: 'Hardware', kannada: 'ಹಾರ್ಡ್‌ವೇರ್' },
    { english: 'Paints & Hardware', kannada: 'ಪೇಂಟ್ಸ್ & ಹಾರ್ಡ್‌ವೇರ್' },
    { english: 'Sanitary & Hardware', kannada: 'ಸ್ಯಾನಿಟರಿ & ಹಾರ್ಡ್‌ವೇರ್' },
  ],
  general: [
    { english: 'General Stores', kannada: 'ಜನರಲ್ ಸ್ಟೋರ್ಸ್' },
    { english: 'General Store', kannada: 'ಜನರಲ್ ಸ್ಟೋರ್' },
    { english: 'Departmental Store', kannada: 'ಡಿಪಾರ್ಟ್‌ಮೆಂಟಲ್ ಸ್ಟೋರ್' },
  ],
}
