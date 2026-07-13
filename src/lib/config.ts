// API Base URL configuration.
// Local development keeps the offline adapter unless an explicit URL is set.
// The exported GitHub Pages app connects to the production FC backend by default.
const PRODUCTION_API_BASE_URL = 'https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL
  || (process.env.NODE_ENV === 'production' ? PRODUCTION_API_BASE_URL : '');
