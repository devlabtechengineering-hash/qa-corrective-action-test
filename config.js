// Only these TWO values need editing. Never use a secret/service_role/database password.
window.QA_CONFIG = Object.freeze({
  supabaseUrl: 'https://xeiduvdkortnvaiyzpye.supabase.co',
  publishableKey: 'sb_publishable_RyKfrABglek2vHV6CEuPww_CesTAkRI',
  imageBucket: 'qa-images',
  reportBucket: 'qa-reports',
  signedUrlSeconds: 3600,
  maxImageBytes: 5 * 1024 * 1024,
  maxFilesPerSave: 20
});
