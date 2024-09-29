module.exports = {
  packagerConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'your_app_name',
        setupExe: `${process.env.npm_package_name}-${process.env.npm_package_version} Setup.exe`
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