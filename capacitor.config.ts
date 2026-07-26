import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.zinith',
  appName: 'Zinith',
  webDir: 'dist',
  android: {
    backgroundColor: '#EDF0F4',
    // Keep the WebView out of the way of input latency (§7.2).
    allowMixedContent: false,
  },
}

export default config
