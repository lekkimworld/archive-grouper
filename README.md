# archive grouper #

Utility to group media files into tar-archives. I use it to group video files (mov and mp4] and images files (heic, jpg, jpeg and png) from my family iPhones into tar-archives I then put into S3 deep archive. The archives are combined with a prefix and then grouped by year and month / or just year if `--by-year-only` is specified. With a prefix of `foo` the resulting files will be like `foo_2022_10.tar`, `foo_2022_11.tar`, `foo_2022_12.tar` etc. The filea are read from a source directory and written to a target directory.

## Running ##
```
npm run install
npx ts-node src/index.ts --help
```

## Example ##
```
npx ts-node src/index.ts \
    --source-dir /tmp/my_images_input \
    --target-dir /tmp/my_images_output \
    --prefix foo
```
