import { context, getOctokit } from '@actions/github';
import { getInput, getMultilineInput } from '@actions/core';

type Octokit = ReturnType<typeof getOctokit>;

type Config = {
    token: string;
    targetName: string;
    targetOwner: string;
    title: string;
    header: string;
    footer: string;
    labelsRequire: string[];
    labelsExclude: string[];
    sort: 'created' | 'updated' | 'comments' | undefined;
    max: number;
}

async function main() {
    console.log('Getting configuration...');
    const config = getConfiguration();
    console.log('Authenticating with token...');
    const client = getOctokit(config.token);

    console.log(`Finding matching issues in ${context.repo.owner}/${context.repo.repo}`);
    const issues = await getIssues(client, config);
    console.log(`Found ${issues.length} matching issues`);
    createOrUpdateTracker(client, config, issues);
    console.log(`Tracker issue in ${config.targetOwner}/${config.targetName} created/updated`);
}

export function getConfiguration(): Config {
    const sortRaw = getInput('sort');
    let sort = undefined;
    if (sortRaw) {
        if (!['created', 'updated', 'comments'].includes(sortRaw)) {
            throw new Error('`sort` must be iether `created`, `updated`, or `comments`');
        }
        sort = sortRaw as 'created' | 'updated' | 'comments' | undefined;
    }

    const maxRaw = getInput('max');
    const max = Number(maxRaw);
    if (Number.isNaN(max)) {
        throw new Error('`max` must be an integer');
    }

    return {
        token: getInput('token', {required: true}),
        targetName: getInput('targetName', {required: true}),
        targetOwner: getInput('targetOwner', {required: true}),
        title: getInput('title', {required: true}),
        header: getInput('header', {required: true}),
        footer: getInput('footer'),
        labelsRequire: getInput('labelsRequire').split(','),
        labelsExclude: getInput('labelsExclude').split(','),
        sort,
        max,
    };
}

async function getIssues(client: Octokit, config: Config) {
    let addedIssues = 0;
    const issues = await client.paginate(
        client.rest.issues.list,
        {
            repo: context.repo.repo,
            filter: 'all',
            sort: config.sort,
            per_page: 100
        },
        (response, done) => response.data.filter((issue) => {
            const requiredLabels = Array.from(config.labelsRequire); // create a copy
            for (const label of issue.labels) {
                const labelText = typeof label === 'string' ? label : label.name;
                if (labelText === undefined) {
                    continue;
                }
                if (config.labelsExclude.includes(labelText)) {
                    return false; // excluded label
                }
                const reqLabelMatch = requiredLabels.indexOf(labelText);
                if (reqLabelMatch !== -1) {
                    requiredLabels.splice(reqLabelMatch, 1);
                }
            }

            if (requiredLabels.length !== 0) {
                return false; // not all required labels satisfied
            }

            addedIssues += 1;
            if (addedIssues >= config.max) {
                done(); // no need to grab any more issues
            }

            return true;
        })
    );
    // cap array size at configured maximum
    issues.length = issues.length > config.max ? config.max : issues.length;
    return issues;
}

async function createOrUpdateTracker(client: Octokit, config: Config, issues: Awaited<ReturnType<typeof getIssues>>) {
    // create issue body
    const listText = issues.reduce((acc, issue) => {
        const checkBox = `- [${issue.state === 'closed' ? 'X' : ' '}]`
        let issueRef = issue.url
        if (issue.repository) {
            issueRef = `${issue.repository.owner}/${issue.repository.name}#${issue.number}`
        }
        return acc += `${checkBox} (${issueRef}) ${issue.title}\n`
    }, '');

    const trackerIssueBody = `${config.header}\n${listText}\n${config.footer}`;

    // check issue exists
    // get all issues created by self on target repo
    const targetSelfIssues = await client.paginate(
        client.rest.issues.list,
        {
            repo: `${config.targetOwner}/${config.targetName}`,
            filter: 'created'
        }
    );

    let targetIssue = undefined;
    for (const issue of targetSelfIssues) {
        if (issue.title === config.title) {
            targetIssue = issue;
            break;
        } 
    }

    // fire off issue creation/update
    if (targetIssue) {
        // update existing issue
        client.rest.issues.update({
            repo: config.targetName,
            owner: config.targetOwner,
            issue_number: targetIssue.number,
            title: config.title,
            body: trackerIssueBody
        });
    } else {
        client.rest.issues.create({
            repo: config.targetName,
            owner: config.targetOwner,
            title: config.title,
            body: trackerIssueBody
        });
    }
}

main();