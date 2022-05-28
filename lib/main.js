"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguration = void 0;
const github_1 = require("@actions/github");
const core_1 = require("@actions/core");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Getting configuration...');
        const config = getConfiguration();
        console.log('Authenticating with token...');
        const client = (0, github_1.getOctokit)(config.token);
        console.log(`Finding matching issues in ${github_1.context.repo.owner}/${github_1.context.repo.repo}`);
        const issues = yield getIssues(client, config);
        console.log(`Found ${issues.length} matching issues`);
        createOrUpdateTracker(client, config, issues);
        console.log(`Tracker issue in ${config.targetOwner}/${config.targetName} created/updated`);
    });
}
function getConfiguration() {
    const sortRaw = (0, core_1.getInput)('sort');
    let sort = undefined;
    if (sortRaw) {
        if (!['created', 'updated', 'comments'].includes(sortRaw)) {
            throw new Error('`sort` must be either `created`, `updated`, or `comments`');
        }
        sort = sortRaw;
    }
    const maxRaw = (0, core_1.getInput)('max');
    const max = Number(maxRaw);
    if (Number.isNaN(max)) {
        throw new Error('`max` must be an integer');
    }
    return {
        token: (0, core_1.getInput)('token', { required: true }),
        targetName: (0, core_1.getInput)('targetName', { required: true }),
        targetOwner: (0, core_1.getInput)('targetOwner', { required: true }),
        title: (0, core_1.getInput)('title', { required: true }),
        header: (0, core_1.getInput)('header', { required: true }),
        footer: (0, core_1.getInput)('footer'),
        labelsRequire: (0, core_1.getInput)('labelsRequire').split(','),
        labelsExclude: (0, core_1.getInput)('labelsExclude').split(','),
        sort,
        max,
    };
}
exports.getConfiguration = getConfiguration;
function getIssues(client, config) {
    return __awaiter(this, void 0, void 0, function* () {
        let addedIssues = 0;
        const issues = yield client.paginate(client.rest.issues.listForRepo, {
            owner: github_1.context.repo.owner,
            repo: github_1.context.repo.repo,
            sort: config.sort,
            per_page: 100
        }, (response, done) => response.data.filter((issue) => {
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
        }));
        // cap array size at configured maximum
        issues.length = issues.length > config.max ? config.max : issues.length;
        return issues;
    });
}
function createOrUpdateTracker(client, config, issues) {
    return __awaiter(this, void 0, void 0, function* () {
        // create issue body
        const listText = issues.reduce((acc, issue) => {
            const checkBox = `- [${issue.state === 'closed' ? 'X' : ' '}]`;
            let issueRef = issue.url;
            if (issue.repository) {
                issueRef = `${issue.repository.owner}/${issue.repository.name}#${issue.number}`;
            }
            return acc += `${checkBox} (${issueRef}) ${issue.title}\n`;
        }, '');
        const trackerIssueBody = `${config.header}\n${listText}\n${config.footer}`;
        // check issue exists
        // get all issues created by self on target repo
        const targetSelfIssues = yield client.paginate(client.rest.issues.listForRepo, {
            owner: config.targetOwner,
            repo: config.targetName,
        });
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
        }
        else {
            client.rest.issues.create({
                repo: config.targetName,
                owner: config.targetOwner,
                title: config.title,
                body: trackerIssueBody
            });
        }
    });
}
main();
