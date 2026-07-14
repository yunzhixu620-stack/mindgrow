// API Base URL configuration.
// Local development keeps the offline adapter unless an explicit URL is set.
// The exported GitHub Pages app connects to the production FC backend by default.
const PRODUCTION_API_BASE_URL = 'https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run';
const PRODUCTION_SUPABASE_URL = 'https://peibbpnovxytxfdswoky.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QkEXOqBYFKvpy3ZiJLTdUA_loDDfEGE';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL
  || (process.env.NODE_ENV === 'production' ? PRODUCTION_API_BASE_URL : '');

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || PRODUCTION_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
