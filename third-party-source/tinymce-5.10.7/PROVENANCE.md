# TinyMCE 5.10.7 editable source

The complete upstream Git tree is retained unmodified in upstream/.
It was obtained only from the official https://github.com/tinymce/tinymce
repository, tag 5.10.7. The official remote resolved that tag to commit
1566b1e71c98bfc0d2c87b84b59c4d55b55b7859; the fetched checkout matched it.
Its root Git tree is f5850b2839cddb35cbce1e2ab1af61e39ed7a1d9.
The source module's package.json declares version 5.10.7 and LGPL-2.1.

SOURCE-MANIFEST.json inventories all 4212 upstream files with original Git
mode, blob identity, byte length and SHA-256. The importer reads raw Git
objects, avoiding checkout line-ending changes, and verifies every output.
The verifier reconstructs the complete original Git tree from the inventory,
so a partial source copy cannot pass merely by retaining familiar filenames.
Executable bits are recorded even on filesystems that do not expose them.
The verifier also checks the actual upstream directory inventory: missing,
changed or extra entries and redirected filesystem paths refuse verification.
On POSIX filesystems it compares executable bits; Windows retains their
original Git modes in the manifest and source tree/index. A source export
must preserve those declared modes even where the host cannot express them.

This includes the preferred TypeScript library source (Editor.ts,
PluginManager.ts, plugins, themes and the other monorepo modules), its full
LGPL text, compilation scripts, workspace manifests, lockfile and contribution
instructions. No upstream install script, build script, dependency download or
source test was run. Upstream build dependencies are identified by its own
manifests/lockfile; this package does not claim those dependencies were installed.

The existing bundled script_tinymce.js identifies itself as version 5.10.7
(2022-12-06). Its unchanged 392236 bytes have SHA-256
3c6a5feeb3fb4dd9b5ab70f3e13b6cb0715136ddb50344b6d3069e9233dc8a9c.
The source is verified against the official tag commit, not against an invented
published binary checksum. The minified library was not rebuilt, and no
bit-for-bit source-to-minified-build reproduction is asserted.
The verifier pins this existing bundled identity independently of editable
manifest metadata. That identity is not an official published binary checksum.

The source material and its notices accompany the local proposed distribution;
there is no deferred distributor offer or assertion that a recipient previously
received it. Keep this source tree, its manifest and the library notices with
the package. Independent source-supply review and approval of the exact overall
package remain separate from this byte/provenance verification.

Verify the retained tree and bundled library from the package root with:

```sh
node tools/vendor/import-tinymce-source.mjs --verify
```

The verifier needs no Git checkout, network, installation or upstream execution.
It verifies upstream source bytes and the bundled identity, not the legal
adequacy of this document. The export inventory must include this provenance
document and all library notices. Verification of already-held bytes does not
repeat the recorded official-tag acquisition or imply a new source download.
For the upstream development build process, read upstream/CONTRIBUTING.md and
the pinned workspace scripts; those are upstream instructions, not actions
performed by the port's ordinary build.
