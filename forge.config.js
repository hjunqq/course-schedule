module.exports = {
  packagerConfig: {
    icon: './icons/tray-icon-big',
    asar: true,
    extraResource: [
      './resources'
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'hhu-course',
        iconUrl: 'https://url-to-your-icon.ico',
        setupIcon: './icons/tray-icon-big.ico'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './icons/tray-icon-big.png'
        }
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: './icons/tray-icon-big.png'
        }
      }
    }
  ]
};