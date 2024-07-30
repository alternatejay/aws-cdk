import {Resource, Stack, Aws, Fn, Token, Annotations, ArnFormat, IResource, RemovalPolicy} from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import {Construct} from "constructs";
import {CfnRepository} from "./codeartifact.generated";
import {Domain, IDomain} from "./domain";
import {ExternalConnection} from "./external-connection";
import * as perms from "./perms";
import {PackageFormat} from "./repository-package";
import {validate} from "./validation";

/**
 * Represents a CodeArtifact repository
 * @experimental
 */
export interface IRepository extends IResource {
    /**
     * The ARN of repository resource.
     * Equivalent to doing `{ 'Fn::GetAtt': ['LogicalId', 'Arn' ]}`
     * in CloudFormation if the underlying CloudFormation resource
     * surfaces the ARN as a return value -
     * if not, we usually construct the ARN "by hand" in the construct,
     * using the Fn::Join function.
     *
     * It needs to be annotated with '@attribute' if the underlying CloudFormation resource
     * surfaces the ARN as a return value.
     *
     * @default Empty string
     * @attribute
     */
    readonly repositoryArn: string;
    /**
     * The physical name of the repository resource.
     * Often, equivalent to doing `{ 'Ref': 'LogicalId' }`
     * (but not always - depends on the particular resource modeled)
     * in CloudFormation.
     * Also needs to be annotated with '@attribute'.
     * @default Empty string
     * @attribute
     */
    readonly repositoryName: string;
    /**
     * A text description of the repository.
     * @attribute
     */
    readonly repositoryDescription?: string;
    /**
     * The domain the repository belongs to
     */
    readonly repositoryDomain: IDomain;
}

/**
 * Reference to a repository
 * @experimental
 */
export interface RepositoryAttributes {
    /**
     * The ARN of repository resource.
     * Equivalent to doing `{ 'Fn::GetAtt': ['LogicalId', 'Arn' ]}`
     * in CloudFormation if the underlying CloudFormation resource
     * surfaces the ARN as a return value -
     * if not, we usually construct the ARN "by hand" in the construct,
     * using the Fn::Join function.
     *
     * It needs to be annotated with '@attribute' if the underlying CloudFormation resource
     * surfaces the ARN as a return value.
     * @default Empty string
     * @attribute
     */
    readonly repositoryArn?: string;
    /**
     * The physical name of the repository resource.
     * Often, equivalent to doing `{ 'Ref': 'LogicalId' }`
     * (but not always - depends on the particular resource modeled)
     * in CloudFormation.
     * Also needs to be annotated with '@attribute'.
     * @default Empty string
     * @attribute
     */
    readonly repositoryName?: string;
    /**
     * A text description of the repository.
     * @default Empty string
     */
    readonly repositoryDescription?: string;
    /**
     * The domain the repository belongs to
     * @default Empty string
     */
    readonly repositoryDomain?: IDomain;
}

/**
 * Properties for a new CodeArtifact repository
 * @experimental
 */
export interface RepositoryProps {
    /**
     * Name the repository
     * @default AWS Unique id
     */
    readonly repositoryName?: string;
    /**
     * A text description of the repository.
     * @default ''
     */
    readonly description?: string;
    /**
     * The name of the domain that contains the repository.
     * @attribute
     * @default None
     */
    readonly repositoryDomain: IDomain;
    /**
     * Upstream repositories for the repository
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repos-upstream.html
     * @default None
     */
    readonly upstreams?: IRepository[];
    /**
     * An array of external connections associated with the repository.
     * @default None
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/external-connection.html#adding-an-external-connection
     */
    readonly externalConnections?: ExternalConnection[];

    /**
     * Principal to associate allow access to the repository
     * @default AccountRootPrincipal
     */
    readonly principal?: iam.IPrincipal;

    /**
     * Principal to associate allow access to the repository
     * @default Read/Write
     */
    readonly policyDocument?: iam.PolicyDocument;

    /**
     * Policy to apply when the resource is removed from this stack
     * @default RemovalPolicy.RETAIN
     */
    readonly removalPolicy?: RemovalPolicy;
}

/**
 * Properties for a new CodeArtifact repository policy restricting package manipulation
 * @experimental
 */
export interface PolicyRepositoryPackage {
    /**
     * Package format
     */
    readonly packageFormat: PackageFormat;
    /**
     * Package namespace
     */
    readonly packageNamespace: string;
    /**
     * Package name
     */
    readonly packageName: string;
}

export const PolicyRepositoryAnyPackage: PolicyRepositoryPackage = {
    packageFormat: PackageFormat.ANY,
    packageNamespace: "*",
    packageName: "*"
};

/**
 * An imported CodeArtifact repository
 */
class ImportedRepository extends Resource implements IRepository {
    public repositoryArn: string;
    public repositoryName: string;
    public repositoryDomain: IDomain;

    constructor(scope: Construct, id: string, props: RepositoryAttributes) {
        super(scope, id);

        if (props.repositoryArn && props.repositoryName) {
            throw new Error("repositoryArn and repositoryName are mutually exclusive");
        }

        if (props.repositoryArn && props.repositoryDomain) {
            throw new Error("repositoryDomain and repositoryArn are mutually exclusive");
        }

        if (!props.repositoryArn && !(props.repositoryName && props.repositoryDomain)) {
            throw new Error("Either repositoryArn or repositoryName, repositoryDomain must be provided");
        }

        if (props.repositoryArn) {
            const arn = Stack.of(this).splitArn(props.repositoryArn, ArnFormat.SLASH_RESOURCE_NAME);
            const domainRepo = arn.resourceName?.split("/") ?? "";
            this.repositoryName = domainRepo[1];
            this.repositoryDomain = Domain.fromDomainAttributes(this, "ImportedDomain", {
                domainName: domainRepo[2],
                domainOwner: arn.account ?? ""
            });
            this.repositoryArn = props.repositoryArn;
            //throw new Error(`could not parse arn ${props.repositoryArn}`);
        } else {
            if (props.repositoryName && props.repositoryDomain) {
                this.repositoryName = props.repositoryName;
                this.repositoryDomain = props.repositoryDomain;
            } else {
                throw new Error("Either repositoryArn or repositoryName, repositoryDomain must be provided");
            }
        }
    }
}

/**
 * A new CodeArtifact repository
 * @experimental
 */
export class Repository extends Resource implements IRepository {
    /**
     * Import an existing Repository provided an ARN
     *
     * @param scope The parent creating construct
     * @param id The construct's name
     * @param repositoryArn repository ARN (i.e. arn:aws:codeartifact:us-east-2:444455556666:repository/my-domain/my-repo)
     */
    public static fromRepositoryArn(scope: Construct, id: string, repositoryArn: string): IRepository {
        return new ImportedRepository(scope, id, {repositoryArn: repositoryArn});
    }

    /**
     * Import an existing repository
     */
    public static fromRepositoryAttributes(scope: Construct, id: string, attrs: RepositoryAttributes): IRepository {
        return new ImportedRepository(scope, id, attrs);
    }

    /**
     * Defines a CloudWatch event rule which triggers for repository events. Use
     * `rule.addEventPattern(pattern)` to specify a filter.
     */
    private static _onEvent(scope: Resource, id: string, context: IRepository, options: events.OnEventOptions = {}) {
        const rule = new events.Rule(scope, id, options);
        rule.addEventPattern({
            source: ["aws.codeartifact"],
            detail: {
                domainName: [context.repositoryDomain.domainName],
                domainOwner: [context.repositoryDomain.domainOwner],
                repositoryName: [context.repositoryName]
            }
        });
        rule.addTarget(options.target);
        return rule;
    }

    /**
     * Defines a CloudWatch event rule which triggers when a "CodeArtifact Package
     *  Version State Change" event occurs.
     */
    private static _onPackageVersionStateChange(
        scope: Resource,
        id: string,
        context: IRepository,
        options: events.OnEventOptions = {}
    ): events.Rule {
        const rule = Repository._onEvent(scope, id, context, options);
        rule.addEventPattern({
            detailType: ["CodeArtifact Package Version State Change"]
        });
        return rule;
    }

    public readonly repositoryArn: string;
    public readonly repositoryName: string;
    public readonly repositoryDomain: IDomain;
    public readonly repositoryDescription?: string;
    private readonly cfnRepository: CfnRepository;

    constructor(scope: Construct, id: string, props: RepositoryProps) {
        super(scope, id, {});

        const repositoryDomainName = props.repositoryDomain.domainName;
        const repositoryDomainOwner = props.repositoryDomain.domainOwner;
        const repositoryName = props.repositoryName ?? this.node.id;
        const repositoryDescription = props.description;

        this.validateProps(repositoryName, repositoryDomainName, repositoryDescription);

        this.cfnRepository = new CfnRepository(this, "Resource", {
            domainName: repositoryDomainName ?? "", //this is required but need coalesce. The validation will catch this.
            domainOwner: repositoryDomainOwner,
            repositoryName: repositoryName,
            description: repositoryDescription,
            upstreams: props.upstreams?.map((u) => u.repositoryName),
            externalConnections: props.externalConnections
        });

        if (props.upstreams) {
            props.upstreams.forEach((u) => this.node.addDependency(u));
        }

        this.repositoryArn = this.cfnRepository.attrArn;
        this.repositoryName = repositoryName;
        this.repositoryDomain = props.repositoryDomain;
        this.repositoryDescription = this.cfnRepository.description;

        if (!props.policyDocument) {
            const p = props.principal || new iam.AccountRootPrincipal();
            this.allowReadFromRepository(p);
            this.allowWriteToRepository(p);
        } else {
            this.cfnRepository.permissionsPolicyDocument = props.policyDocument;
        }

        props.removalPolicy
            ? this.cfnRepository.applyRemovalPolicy(props.removalPolicy)
            : this.cfnRepository.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    /**
     * Assign the repository to a domain
     * @param domain The domain the repository will be assigned to
     */
    public assignDomain(domain: IDomain): void {
        // This should be added to the L1 props soon, but until then this is required to create a Repository
        // this.cfnRepository.node.addDependency(domain);

        this.cfnRepository.domainName = domain.domainName ?? "";
    }

    /**
     * Adds a statement to the IAM resource policy associated with this repository.
     */
    public addToResourcePolicy(statement: iam.PolicyStatement): iam.AddToResourcePolicyResult {
        const p = (this.cfnRepository.permissionsPolicyDocument as iam.PolicyDocument) || new iam.PolicyDocument();

        p.addStatements(statement);

        this.cfnRepository.permissionsPolicyDocument = p;

        return {statementAdded: true, policyDependable: p};
    }

    public grantRead(identity: iam.IGrantable): iam.Grant {
        return this.grant(identity, [...perms.REPOSITORY_READ_ACTIONS]);
    }
    public grantReadAssociate(identity: iam.IGrantable): iam.Grant {
        return this.grant(identity, [...perms.REPOSITORY_READ_ACTIONS, ...perms.REPOSITORY_ASSOCIATE_ACTIONS]);
    }

    public grantWrite(identity: iam.IGrantable): iam.Grant {
        return this.grant(identity, [...perms.REPOSITORY_WRITE_ACTIONS]);
    }

    public grantReadWrite(identity: iam.IGrantable): iam.Grant {
        return this.grant(identity, [...perms.REPOSITORY_READ_ACTIONS, ...perms.REPOSITORY_WRITE_ACTIONS]);
    }

    public grantReadWriteDeletePackage(
        identity: iam.IGrantable,
        packages: PolicyRepositoryPackage[] = [PolicyRepositoryAnyPackage]
    ): iam.Grant {
        return this.grant(
            identity,
            [...perms.REPOSITORY_READ_ACTIONS, ...perms.REPOSITORY_WRITE_ACTIONS, ...perms.REPOSITORY_DELETE_PACKAGE_ACTIONS],
            packages.map((p) => {
                return this.packageArn(p, true);
            })
        );
    }

    public grant(identity: iam.IGrantable, actions: string[], resourceArns: string[] = ["*"]): iam.Grant {
        return iam.Grant.addToPrincipalOrResource({
            grantee: identity,
            actions: actions,
            resourceArns,
            resource: this
        });
    }

    /**
     * Defines a CloudWatch event rule which triggers for repository events. Use
     * `rule.addEventPattern(pattern)` to specify a filter.
     */
    public onEvent(id: string, options: events.OnEventOptions = {}) {
        const rule = new events.Rule(this, id, options);
        rule.addEventPattern({
            source: ["aws.codeartifact"],
            detail: {
                domainName: [this.repositoryDomain.domainName],
                domainOwner: [this.repositoryDomain.domainOwner],
                repositoryName: [this.repositoryName]
            }
        });
        rule.addTarget(options.target);
        return rule;
    }

    /**
     * Defines a CloudWatch event rule which triggers when a "CodeArtifact Package
     *  Version State Change" event occurs.
     */
    public onPackageVersionStateChange(id: string, options: events.OnEventOptions = {}): events.Rule {
        const rule = this.onEvent(id, options);
        rule.addEventPattern({
            detailType: ["CodeArtifact Package Version State Change"]
        });
        return rule;
    }

    private validateProps(repositoryName: string, repositoryDomainName?: string, repositoryDescription?: string) {
        validate(
            "Description",
            {
                maxLength: 1000,
                pattern: /\P{C}+/gi,
                documentationLink:
                    "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-description"
            },
            repositoryDescription
        );

        validate(
            "DomainName",
            {
                required: true,
                minLength: 2,
                maxLength: 50,
                pattern: /[a-z][a-z0-9\-]{0,48}[a-z0-9]/gi,
                documentationLink:
                    "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-domainname"
            },
            repositoryDomainName
        );

        validate(
            "RepositoryName",
            {
                required: true,
                minLength: 2,
                maxLength: 100,
                pattern: /[A-Za-z0-9][A-Za-z0-9._\-]{1,99}/gi,
                documentationLink:
                    "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-repository.html#cfn-codeartifact-repository-repositoryname"
            },
            repositoryName
        );
    }

    /**
     * Adds read actions for the principal to the repository's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowReadFromRepository(principal: iam.IPrincipal): iam.AddToResourcePolicyResult {
        return this.addToResourcePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [principal],
                actions: [
                    "codeartifact:DescribePackageVersion",
                    "codeartifact:DescribeRepository",
                    "codeartifact:GetPackageVersionReadme",
                    "codeartifact:GetRepositoryEndpoint",
                    "codeartifact:ListPackageVersionAssets",
                    "codeartifact:ListPackageVersionDependencies",
                    "codeartifact:ListPackageVersions",
                    "codeartifact:ListPackages",
                    "codeartifact:ReadFromRepository"
                ],
                resources: ["*"]
            })
        );
    }

    /**
     * Allows PublishPackageVersion and PutPackageMetadata only for the package and namespace
     * when acted upon by the principal.
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowWriteToRepositoryPackages(
        principal: iam.IPrincipal,
        repositoryPackages: PolicyRepositoryPackage[]
    ): iam.AddToResourcePolicyResult {
        const resources = repositoryPackages.map((repositoryPackage) => this.packageArn(repositoryPackage, true));
        return this.allowWriteToRepository(principal, resources);
    }

    /**
     * Allows PublishPackageVersion, PutPackageMetadata and DeletePackageVersions for the package
     * when acted upon by the principal.
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowWriteDeleteOnRepositoryPackages(
        principal: iam.IPrincipal,
        repositoryPackages: PolicyRepositoryPackage[]
    ): iam.AddToResourcePolicyResult {
        const resources = repositoryPackages.map((repositoryPackage) => this.packageArn(repositoryPackage, true));
        return this.allowWriteDeleteOnRepository(principal, resources);
    }

    /**
     * Adds PublishPackageVersion and PutPackageMetadata for the principal to the repository's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowWriteToRepository(principal: iam.IPrincipal, resources = ["*"]): iam.AddToResourcePolicyResult {
        return this.addToResourcePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [principal],
                actions: ["codeartifact:PublishPackageVersion", "codeartifact:PutPackageMetadata"],
                resources
            })
        );
    }
    /**
     * Adds DeletePacakgeVersion for the principal to the repository's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowDeleteFromRepository(principal: iam.IPrincipal, resources = ["*"]): iam.AddToResourcePolicyResult {
        return this.addToResourcePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [principal],
                actions: ["codeartifact:DeletePackageVersions"],
                resources
            })
        );
    }
    /**
     * Adds PublishPackageVersion, PutPackageMetadata, and DeletePackageVersion for the principal
     * to the repository's resource policy
     * @param principal The principal for the policy
     * @param resources The resources for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repo-policies.html
     */
    public allowWriteDeleteOnRepository(principal: iam.IPrincipal, resources = ["*"]): iam.AddToResourcePolicyResult {
        return this.addToResourcePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [principal],
                actions: ["codeartifact:PublishPackageVersion", "codeartifact:PutPackageMetadata", "codeartifact:DeletePackageVersions"],
                resources
            })
        );
    }

    /**
     * Formulate a package arn for this repository
     * @param repositoryPackage The package to formulate the arn for
     */
    public packageArn(repositoryPackage: PolicyRepositoryPackage, useResourceArns = false): string {
        const repositoryDomainOwner = useResourceArns ? "*" : this.repositoryDomain.domainOwner;
        const repositoryDomainName = useResourceArns ? "*" : this.repositoryDomain.domainName;
        return Stack.of(this).formatArn({
            service: "codeartifact",
            resource: "package",
            region: useResourceArns ? "*" : undefined,
            account: useResourceArns ? "*" : undefined,
            partition: useResourceArns ? "*" : undefined,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            resourceName: [
                repositoryDomainOwner,
                repositoryDomainName,
                repositoryPackage.packageFormat,
                repositoryPackage.packageNamespace,
                repositoryPackage.packageName
            ].join("/")
        });
    }

    /**
     * External connections to pull from
     * @default None
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/external-connection.html#adding-an-external-connection
     */
    public withExternalConnections(...externalConnections: ExternalConnection[]): IRepository {
        if (externalConnections.length) {
            this.cfnRepository.externalConnections = externalConnections;
        }

        return this;
    }

    /**
     * Add upstream repository to the repository
     * @param repository The upstream repository
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/repos-upstream.html
     */
    public withUpstream(...repository: IRepository[]): IRepository {
        this.cfnRepository.upstreams = repository.map((f) => f.repositoryName || "");

        return this;
    }
}
