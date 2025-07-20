rimraf WebKit Debug-Kit
git clone --filter=blob:none --depth=1 --sparse --no-checkout https://github.com/WebKit/WebKit.git WebKit
git -C WebKit sparse-checkout init --cone
git -C WebKit sparse-checkout set Source/WebInspectorUI/UserInterface
git -C WebKit fetch --depth=1 origin tag wpewebkit-2.49.3
git -C WebKit checkout wpewebkit-2.49.3 -b local-build
git submodule update --init
