/**
 * Default site settings.
 *
 * The same object seeds the `settings` table on first run and documents the
 * contract shared by the admin panel and the public site. Keys added here are
 * backfilled into already-stored objects by settings.js `withDefaults()`, so no
 * data migration is needed.
 */
const DEFAULT_SETTINGS = {
  site: {
    name: 'Amper Avto Elektro',
    logo: '',
    favicon: '',
    phone: '+998 90 123 45 67',
    email: 'info@amper.uz',
    telegram: 'https://t.me/amperuz',
    instagram: 'https://instagram.com/amper.uz',
    address: 'Toshkent sh., Chilonzor tumani, 12-mavze',
    working_hours: 'Dushanba – Shanba: 09:00 – 19:00',
  },
  hero: {
    title: 'Avtomobil elektr tizimlari bo\'yicha ishonchli xizmat',
    subtitle: 'Simlar, starter, generator, akkumulyator va sensorlar. Nosozlikning aniq sababini topamiz va ishonchli ta\'mirlaymiz.',
    background_image: '',
    button_text: 'Xizmatlar',
    button_link: '#services',
    show: true,
    // Hero statistics. The "experience" figure is not stored here on purpose: it is
    // derived from `about.experience` / `about.experience_label` so the two
    // sections can never show different numbers.
    stats_customers_value: '5000+',
    stats_customers_label: 'Tuzatilgan avtomobillar',
    stats_support_value: '24/7',
    stats_support_label: 'Tezkor yordam',
  },
  about: {
    title: 'Biz haqimizda',
    description: 'Amper Avto Elektro — avtomobil elektr tizimlari, simlari va elektron jihozlarini ta\'mirlashga ixtisoslashgan ustaxona. Zamonaviy diagnostika uskunalari bilan har bir nosozlikning aniq sababini topamiz.',
    image: '',
    experience: 10,
    experience_label: 'Yillik tajriba',
    show: true,
  },
  contact: {
    // `show` belongs to the contract: the admin toggle and the public section read
    // the same key, otherwise the panel shows "off" while the section is visible.
    show: true,
    phone: '+998 90 123 45 67',
    telegram: 'https://t.me/amperuz',
    instagram: 'https://instagram.com/amper.uz',
    address: 'Toshkent sh., Chilonzor tumani, 12-mavze',
    email: 'info@amper.uz',
    working_hours: 'Dushanba – Shanba: 09:00 – 19:00\nYakshanba: dam olish kuni',
    map_link: '',
  },
  design: {
    primary_color: '#079cf0',
    secondary_color: '#0f1722',
    font_family: 'Manrope',
    show_services: true,
    show_about: true,
  },
  footer: {
    text: 'Amper Avto Elektro — avtomobilingizning elektr tizimlari uchun ishonchli xizmat.',
    copyright: '© 2026 Amper Avto Elektro. Barcha huquqlar himoyalangan.',
  },
  worklog: {
    public_show: false,
  },
};

const DEFAULT_MASTER_PERMISSIONS = ['content', 'services', 'media'];

module.exports = { DEFAULT_SETTINGS, DEFAULT_MASTER_PERMISSIONS };
