import exifr  from "exifr";
import fs  from "fs/promises";
import path from "path";
import moment, {Moment} from "moment-timezone";
import semaphore from "semaphore";
import tar from "tar";
import commandLineUsage from "command-line-usage";
import parseCmd from "command-line-args";

interface Bucket {
    months: Record<string,FileDetails[]>;
}
interface FileDetails {
    path : string;
    extension : string;
    movie : boolean;
    picture : boolean;
    exif : any;
    createdDate : Moment;
}
const getFileDetails = async (basePath : string, file : string) : Promise<FileDetails> => {
    // get extension
    const fullPath = path.join(basePath, file)
    const parts = file.split(".");
    const extension = parts[parts.length - 1].toLowerCase();
    let movie = false;
    let picture = false;
    let createdDt : Moment | undefined;

    if (["mov", "mp4"].includes(extension)) {
        // movie
        movie = true;
    } else if (["heic", "jpg", "jpeg", "png"].includes(extension)) {
        picture = true;

        // try and get exif from picture
        var exifData = await exifr.parse(fullPath);
        if (exifData && exifData.DateTimeOriginal) {
            moment.tz();
            createdDt = moment.tz(exifData.DateTimeOriginal, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", "UTC");
        }
    } else {
        // unknown
        throw new Error(`Unhandled extension <${extension}> (${fullPath})`);
    }

    if (!createdDt) {
        const dt = (await fs.stat(fullPath)).birthtime;
        createdDt = moment(dt);
    }
    
    // return
    return {
        picture,
        movie,
        path: fullPath,
        extension,
        exif: exifData,
        createdDate: createdDt
    } as FileDetails;
}

const bucketFilesByYearMonth = async (directory : string) : Promise<Record<string, Bucket>> => {
    const files = await fs.readdir(path.join(directory));
    const years: Record<string, Bucket> = {};
    const sem = semaphore(1);

    const details = await Promise.allSettled(
        files.map(async (file): Promise<FileDetails | undefined> => {
            try {
                const details = await getFileDetails(directory, file);
                sem.take(() => {
                    const year = `${details.createdDate.year()}`;
                    const month =
                        details.createdDate.month() + 1 < 10
                            ? `0${details.createdDate.month() + 1}`
                            : `${details.createdDate.month() + 1}`;
                    let bucketYear = years[year];
                    if (!bucketYear) {
                        bucketYear = { months: {} } as Bucket;
                        bucketYear.months[month] = [details];
                        years[year] = bucketYear;
                    } else {
                        if (bucketYear.months[month]) {
                            bucketYear.months[month].push(details);
                        } else {
                            const b: FileDetails[] = [];
                            b.push(details);
                            bucketYear.months[month] = b;
                        }
                    }

                    // leave semaphore
                    sem.leave();
                });
                return details;
            } catch (err: any) {
                return Promise.reject(err);
            }
        })
    );
    return years;
}

const bucketFilesByYear = async (directory: string): Promise<Record<string, FileDetails[]>> => {
    const files = await fs.readdir(path.join(directory));
    const years: Record<string, FileDetails[]> = {};
    const sem = semaphore(1);

    const details = await Promise.allSettled(
        files.map(async (file): Promise<FileDetails | undefined> => {
            try {
                const details = await getFileDetails(directory, file);
                sem.take(() => {
                    const year = `${details.createdDate.year()}`;
                    let bucketYear = years[year];
                    if (!bucketYear) {
                        bucketYear = []
                        years[year] = bucketYear;
                        bucketYear.push(details);
                    } else {
                        bucketYear.push(details);
                    }

                    // leave semaphore
                    sem.leave();
                });
                return details;
            } catch (err: any) {
                return Promise.reject(err);
            }
        })
    );
    return years;
};

export const cliErrorAndExit = (msg: string) => {
    console.log(`ERROR: ${msg}. Use --help for options.`);
    process.exit(1);
};

export const cliCheckHelp = (cmdOpts: Array<any>, options: any, header: string) => {
    if (options.help) {
        const usage = commandLineUsage([
            {
                header,
            },
            {
                header: "Options",
                optionList: cmdOpts,
            },
        ]);

        console.log(usage);
        process.exit(0);
    }
};

const cmdOpts: Array<any> = [
    {
        name: "help",
        type: Boolean,
    },
    {
        name: "by-year-only",
        default: false,
        type: Boolean,
    },
    {
        name: "source-dir",
        type: String,
        alias: "s",
        description: `Path to read images and videos from"`,
    },
    {
        name: "target-dir",
        type: String,
        alias: "t",
        description: `Path to write tar-archives to`,
    },
    {
        name: "prefix",
        type: String,
        alias: "p",
        description: `Prefix for created archives - will end up as <target-dir>/<prefix>_<year/month suffix>.tar or <target-dir>/<prefix>_<year>.tar if --by-year-only is specified.`,
    },
];
const options = parseCmd(cmdOpts);
cliCheckHelp(cmdOpts, options, "Splits images and videos into tar-achives based on month and year");
if (!options["source-dir"]) {
    cliErrorAndExit("Must specify source directory");
}
if (!options["target-dir"]) {
    cliErrorAndExit("Must specify target directory");
}
if (!options["prefix"]) {
    cliErrorAndExit("Must specify prefix for resulting tar-archives");
}

const main = async (tarDirectory : string, tarPrefix : string, directory : string, by_year_only: boolean) => {
    if (by_year_only) {
        const years = await bucketFilesByYear(directory);

        // write year tar files
        await Promise.all(
            Object.keys(years).map(async (year) => {
                const file = path.join(tarDirectory, `${tarPrefix}_${year}.tar`);
                console.log(`Creating ${file}`);
                await tar.create(
                    {
                        gzip: false,
                        file,
                    },
                    years[year].map((fd) => fd.path)
                );
            })
        );
    } else {
        const years = await bucketFilesByYearMonth(directory);

        // write year-month tar files
        await Promise.all(Object.keys(years).map(async year => {
            await Promise.all(Object.keys(years[year].months).sort().map(async month => {
                const file = path.join(tarDirectory, `${tarPrefix}_${year}_${month}.tar`);
                console.log(`Creating ${file}`);
                await tar.create(
                    {
                        gzip: false,
                        file,
                    },
                    years[year].months[month].map((fd) => fd.path)
                )
            }))
        }))
    }

    // exit
    process.exit(0);
};
main(options["target-dir"], options["prefix"], options["source-dir"], options["by-year-only"]);
