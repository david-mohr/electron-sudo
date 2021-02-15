module.exports = (api) => {
  // Cache configuration is a required option
  api.cache(false);

  const presets = [
    [
      "@babel/preset-env", 
      { 
        "targets": {
          "node": "12.20"
        },
        useBuiltIns: false
      }
    ]
  ];

  return { presets };
};
