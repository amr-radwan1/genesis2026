const { withProjectBuildGradle, withAndroidManifest } = require('@expo/config-plugins');

const withNotifee = (config) => {
  config = withProjectBuildGradle(config, async (config) => {
    const buildGradle = config.modResults.contents;
    const notifeeMaven = `maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`;

    if (!buildGradle.includes('notifee')) {
      // Find the allprojects -> repositories block and inject the maven url
      config.modResults.contents = buildGradle.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        `allprojects {\n    repositories {\n        ${notifeeMaven}`
      );
    }
    return config;
  });

  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const application = androidManifest.manifest.application[0];

    // Ensure Notifee Foreground Service is explicitly declared as microphone type
    if (!application.service) {
      application.service = [];
    }

    const hasNotifeeService = application.service.some(
      (s) => s.$['android:name'] === 'app.notifee.core.ForegroundService'
    );

    if (!hasNotifeeService) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
      
      application.service.push({
        $: {
          'android:name': 'app.notifee.core.ForegroundService',
          'android:foregroundServiceType': 'microphone|shortService',
          'android:exported': 'false',
          'tools:replace': 'android:foregroundServiceType',
        },
      });
    }

    return config;
  });
};

module.exports = withNotifee;
