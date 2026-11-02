"""
CI only (iOS TestFlight workflow): switch the Release builds of the app and its Share Extension to manual signing
with the fixed App Store profiles installed by the workflow. Debug keeps automatic signing.

    python3 ios_manual_signing.py MeetMe.xcodeproj/project.pbxproj
"""
import re
import sys

PROFILES = {
    'com.gosite.cellmate': 'CellMate AppStore',
    'com.gosite.cellmate.share': 'CellMate Share AppStore',
}

path = sys.argv[1]
text = open(path, encoding='utf-8').read()
changed = 0


def fix(m: re.Match) -> str:
    global changed
    block = m.group(0)
    if 'name = Release;' not in block:
        return block
    bid = re.search(r'PRODUCT_BUNDLE_IDENTIFIER = "?([\w.]+)"?;', block)
    if not bid or bid.group(1) not in PROFILES:
        return block
    block = block.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')
    extra = f'\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{PROFILES[bid.group(1)]}";'
    changed += 1
    return block.replace('buildSettings = {', 'buildSettings = {' + extra, 1)


text = re.sub(r'[0-9A-F]{24} /\* Release \*/ = \{\s*isa = XCBuildConfiguration;.*?\n\s*name = Release;\n\s*\};', fix, text, flags=re.S)
if changed != len(PROFILES):
    sys.exit(f'expected {len(PROFILES)} Release configurations to sign, changed {changed}')
open(path, 'w', encoding='utf-8').write(text)
print(f'manual signing for {changed} targets')
