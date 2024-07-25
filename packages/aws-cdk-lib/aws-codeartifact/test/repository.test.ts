import "@aws-cdk/assert/jest";
import * as cdkassert from "@aws-cdk/assert";
import {Stack} from "aws-cdk-lib";
import {AccountRootPrincipal, PolicyDocument, PolicyStatement, Effect} from "aws-cdk-lib/aws-iam";
import {Domain, Repository, ExternalConnection} from "../lib";

test("Domain w/ Repository", () => {
    const stack = new Stack();

    const {repositoryDomain, repo} = createDomainAndRepo(stack);

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Domain", {
            DomainName: repositoryDomain.domainName
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo.repositoryName
        })
    );
});

test("Domain w/ Repository and policy document", () => {
    const stack = new Stack();

    const p = new PolicyDocument();

    p.addStatements(
        new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["codeartifact:DescribePackageVersion"]
        })
    );

    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});
    const repo = new Repository(stack, "repository-1", {repositoryName: "example-repo", repositoryDomain, policyDocument: p});

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Domain", {
            DomainName: repositoryDomain.domainName
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo.repositoryName
        })
    );
});

test("Domain w/ 2 Repositories via constructor, w/ upstream, and external connection", () => {
    const stack = new Stack();

    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});
    const repo1 = new Repository(stack, "repository-1", {
        repositoryName: "example-repo-1",
        repositoryDomain,
        externalConnections: [ExternalConnection.NPM_NPMJS]
    });
    new Repository(stack, "repository-2", {repositoryName: "example-repo-2", repositoryDomain, upstreams: [repo1]});

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Domain", {
            DomainName: repositoryDomain.domainName
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo1.repositoryName,
            DomainName: stack.resolve(repositoryDomain.domainName)
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo1.repositoryName,
            DomainName: stack.resolve(repositoryDomain.domainName)
        })
    );
});

test("Domain w/ 2 Repositories, w/ upstream, and external connection", () => {
    const stack = new Stack();

    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});
    const repo1 = new Repository(stack, "repository-1", {repositoryName: "example-repo-1", repositoryDomain});
    const repo2 = new Repository(stack, "repository-2", {repositoryName: "example-repo-2", repositoryDomain});

    repo1.withExternalConnections(ExternalConnection.NPM_NPMJS);
    repo2.withUpstream(repo1);

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Domain", {
            DomainName: repositoryDomain.domainName
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo1.repositoryName,
            DomainName: stack.resolve(repositoryDomain.domainName)
        })
    );

    cdkassert.expect(stack).to(
        cdkassert.haveResource("AWS::CodeArtifact::Repository", {
            RepositoryName: repo1.repositoryName,
            DomainName: stack.resolve(repositoryDomain.domainName)
        })
    );
});

test("Repository from ARN", () => {
    const stack = new Stack();

    const repo = Repository.fromRepositoryArn(
        stack,
        "repo-from-arn",
        "arn:aws:codeartifact:region-id:123456789012:repository/my-domain/my-repo"
    );
    expect(repo.repositoryName).toBe("my-repo");
});

test("Grant AccountRootPrincipal read on Repository", () => {
    const stack = new Stack();
    const {repo} = createDomainAndRepo(stack);
    repo.grantRead(new AccountRootPrincipal());
});

test("Grant AccountRootPrincipal read/write on Repository", () => {
    const stack = new Stack();
    const {repo} = createDomainAndRepo(stack);
    repo.grantReadWrite(new AccountRootPrincipal());
});

test("Grant AccountRootPrincipal write on Repository", () => {
    const stack = new Stack();
    const {repo} = createDomainAndRepo(stack);
    repo.grantWrite(new AccountRootPrincipal());
});

test("Grant AccountRootPrincipal delete on repository", () => {
    const stack = new Stack();
    const {repo} = createDomainAndRepo(stack);
    repo.allowDeleteFromRepository(new AccountRootPrincipal());
});

test("Event rule for Repository", () => {
    const stack = new Stack();
    const {repo} = createDomainAndRepo(stack);

    repo.onPackageVersionStateChange("subscription", {});
});

test("Repository description too long", () => {
    const description: string[] = [];
    for (let i = 0; i <= 2001; i++) {
        description.push("a");
    }

    const stack = new Stack();
    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});

    expect(() => {
        new Repository(stack, "repository-1", {repositoryName: "example-repo-1", repositoryDomain, description: description.join("")});
    }).toThrow(
        "Description: must match pattern \\P{C}+. Must match rules from https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-description"
    );
});

test("Repository invalid domain name length", () => {
    const domainName: string[] = [];
    for (let i = 0; i <= 51; i++) {
        domainName.push("a");
    }

    const stack = new Stack();
    expect(() => {
        const repositoryDomain = new Domain(stack, "domain", {domainName: domainName.join("")});
        new Repository(stack, "repository-1", {repositoryName: "example-repo-1", repositoryDomain});
    }).toThrow(/DomainName: must be less than 50 characters long./);
});

test("Repository invalid RepositoryName length", () => {
    const respoName: string[] = [];
    for (let i = 0; i <= 100; i++) {
        respoName.push("a");
    }

    const stack = new Stack();
    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});

    expect(() => {
        new Repository(stack, "repository-1", {repositoryName: respoName.join(""), repositoryDomain});
    }).toThrow(
        "RepositoryName: must be less than 100 characters long. Must match rules from https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-repositoryname"
    );
});

test("Repository invalid RepositoryName pattern", () => {
    const stack = new Stack();
    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});

    expect(() => {
        new Repository(stack, "repository-1", {repositoryName: "@@@@@", repositoryDomain});
    }).toThrow(
        "RepositoryName: must match pattern [A-Za-z0-9][A-Za-z0-9._\\-]{1,99}. Must match rules from https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-repositoryname"
    );
});

function createDomainAndRepo(stack: Stack) {
    const repositoryDomain = new Domain(stack, "domain", {domainName: "example-domain"});
    const repo = new Repository(stack, "repository", {
        repositoryName: "example-repo",
        repositoryDomain
    });

    return {repositoryDomain, repo};
}
