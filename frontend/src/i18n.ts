import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslation from './locales/en.json';
import deTranslation from './locales/de.json';

const initialLanguage = localStorage.getItem('trackmanager_language') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslation,
      },
      de: {
        translation: deTranslation,
      },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // react already escapes values
    },
  });

export default i18n;
