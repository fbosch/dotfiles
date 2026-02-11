(function () {
  function configureQuicklink() {
    if (!window.quicklink || typeof window.quicklink.listen !== "function") {
      return;
    }

    window.quicklink.listen({
      timeout: 2000,
      origins: true,
      prerenderAndPrefetch: true,
      ignores: [
        function (uri, elem) {
          return (
            elem.hasAttribute("download") ||
            elem.getAttribute("target") === "_blank" ||
            uri.indexOf("/i/?c=feed&a=actualize") !== -1 ||
            uri.indexOf("mailto:") === 0 ||
            uri.indexOf("tel:") === 0
          );
        },
      ],
    });
  }

  if (document.readyState === "complete") {
    configureQuicklink();
  } else {
    window.addEventListener("load", configureQuicklink);
  }
})();
