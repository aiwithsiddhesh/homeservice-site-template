# Client images

Store JPG, PNG, WebP, or AVIF files here. Subdirectories are supported.
Use lowercase extensions and filenames containing letters, numbers, underscores,
or hyphens. Reference them from the client JSON, for example
`"heroImage": "assets/acme-roofing/roof.webp"` with a descriptive `heroImageAlt`.
Optional `logoImage` and `logoAlt` work the same way.

Only referenced files are copied to the generated site. Images are not optimized
by the build. Prefer a compressed 1200 × 900 hero photo below 200 KB.
