import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Resource, Stack, Lazy, Token, ArnFormat, IResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnDomain } from './codeartifact.generated';
import { IRepository } from './repository';
import { DOMAIN_CREATE_ACTIONS, DOMAIN_LOGIN_ACTIONS, DOMAIN_READ_ACTIONS } from './perms';
import { validate } from './validation';

/**
 * Represents a CodeArtifact domain
 * @experimental
 */
export interface IDomain extends IResource {
  /**
* The ARN of domain resource.
* @attribute
*/
  readonly domainArn: string;

  /**
   * The physical name of the domain resource.
   * @attribute
   */
  readonly domainName: string;

  /**
   * The domain owner AWS account id, enables cross-account domains.
   * @attribute
   */
  readonly domainOwner: string;

  /**
   * The KMS encryption key used for the domain resource.
   * @default AWS Managed Key
   * @attribute
   */
  readonly domainEncryptionKey?: kms.IKey;

  /**
   * Resource policy for the domain
   */
  readonly policyDocument?: iam.PolicyDocument
}

/**
 * Properties for referring to a CDK-external domain
 * @experimental
 */
export interface DomainAttributes {
  /**
   * full ARN of a CodeArtifact domain
   * should look like this: arn:aws:codeartifact:{region}:{account}:domain/{domain}
   */
  readonly domainArn?: string;

  /**
   * The physical name of the domain resource.
   */
  readonly domainName?: string;

  /**
   * The domain owner
   * @default the account in which the CDK stack is deployed
   * @attribute
   */
  readonly domainOwner?: string;
}

/**
 * Properties for a new CodeArtifact domain
 * @experimental
 */
export interface DomainProps {
  /**
  * The name of the domain
  * @default Unique id
  */
  readonly domainName?: string;

  /**
   * The KMS encryption key used for the domain resource.
   * @default AWS Managed Key
   * @attribute
   */
  readonly domainEncryptionKey?: kms.IKey;
  /**
     * Principal for the resource policy for the domain
     * @default AccountRootPrincipal
     */
  readonly principal?: iam.IPrincipal

  /**
   * Resource policy for the domain
   * @default Open policy that allows principal to reader, create, and generate authorization token.
   */
  readonly policyDocument?: iam.PolicyDocument
}

/**
 * An imported CodeArtifact domain
 */
class ImportedDomain extends Resource implements IDomain {
  public readonly domainArn: string;
  public readonly domainName: string;
  public readonly domainOwner: string;

  constructor(scope: Construct, id: string, props: DomainAttributes) {
    super(scope, id);

    if (props.domainArn && props.domainName) {
      throw new Error('domainArn and domainName are mutually exclusive');
    }
    if (props.domainArn && props.domainOwner) {
      throw new Error('domainArn and domainOwner are mutually exclusive');
    }

    if (props.domainArn) {
      this.domainArn = props.domainArn;
      this.domainName = Stack.of(this).splitArn(props.domainArn, ArnFormat.SLASH_RESOURCE_NAME).resourceName!;
      this.domainOwner = props.domainArn.split(':')[4];
    }

    if (props.domainName) {
      this.domainName = props.domainName;
      if (!props.domainOwner) {
        this.domainOwner = Stack.of(this).account
      } else {
        this.domainOwner = props.domainOwner;
      }
      this.domainArn = Stack.of(this).formatArn({
        service: 'codeartifact',
        resource: 'domain',
        resourceName: props.domainName,
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        account: this.domainOwner,
      });
    }
  }
}

/**
 * A new CodeArtifacft domain
 * @experimental
 */
export class Domain extends Resource implements IDomain {
  /**
 * Import an existing domain provided an ARN
 *
 * @param scope The parent creating construct
 * @param id The construct's name
 * @param domainArn Domain ARN (i.e. arn:aws:codeartifact:us-east-2:444455556666:domain/MyDomain)
 */
  public static fromDomainArn(scope: Construct, id: string, domainArn: string): IDomain {
    return new ImportedDomain(scope, id, { domainArn: domainArn});
  }

  /**
   * Import an existing domain
   */
  public static fromDomainAttributes(scope: Construct, id: string, attrs: DomainAttributes): IDomain {
    return new ImportedDomain(scope, id, attrs);
  }

  public readonly domainName: string;
  public readonly domainArn: string;
  public readonly domainOwner: string;
  public readonly domainEncryptionKey?: kms.IKey;
  public readonly policyDocument?: iam.PolicyDocument;
  private readonly cfnDomain: CfnDomain;

  constructor(scope: Construct, id: string, props?: DomainProps) {
    super(scope, id);

    // Set domain and encryption key as we will validate them before creation
    const domainName = props?.domainName ?? this.node.id;
    const domainEncryptionKey = props?.domainEncryptionKey ?? null;

    this.validateProps(domainName, domainEncryptionKey);

    // Create the CFN domain instance
    this.cfnDomain = new CfnDomain(this, 'Resource', {
      domainName: domainName,
      permissionsPolicyDocument: Lazy.uncachedAny({ produce: () => props?.policyDocument?.toJSON() }),
      encryptionKey: domainEncryptionKey?.keyId,
    });

    this.domainName = domainName;
    this.domainArn = this.cfnDomain.attrArn;
    this.domainOwner = this.cfnDomain.attrOwner;
    this.policyDocument = props?.policyDocument;
  }

  private validateProps(domainName : string, domainEncryptionKey? : kms.IKey | null) {
    if (Token.isUnresolved(domainName)) {
      throw new Error(`'domainName' must resolve, got: '${domainName}'`);
    }

    validate('DomainName',
      { required: true, minLength: 2, maxLength: 50, pattern: /[a-z][a-z0-9\-]{0,48}[a-z0-9]/gi, documentationLink: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-domain.html#cfn-codeartifact-domain-domainname' },
      domainName);

    validate('EncryptionKey',
      { minLength: 1, maxLength: 2048, pattern: /\S+/gi, documentationLink: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-codeartifact-domain.html#cfn-codeartifact-domain-encryptionkey' },
      domainEncryptionKey?.keyArn || '');
  }

  /**
   * Adds a statement to the IAM resource policy associated with this domain.
   */
  public addToResourcePolicy(statement: iam.PolicyStatement): iam.AddToResourcePolicyResult {

    if (!this.policyDocument) {
      const p = this.policyDocument || new iam.PolicyDocument();

      p.addStatements(statement);

      return { statementAdded: true, policyDependable: p };
    }

    return { statementAdded: false };
  }

  private grant(principal: iam.IGrantable, iamActions: string[], resource: string = '*'): iam.Grant {
    return iam.Grant.addToPrincipalOrResource({
      grantee: principal,
      actions: iamActions,
      resourceArns: [resource],
      resource: this,
    });
  }

  /**
   * Assign default login, creation, and read for the domain.
   * @param principal The principal of for the policy
   * @see https://docs.aws.amazon.com/codeartifact/latest/ug/domain-policies.html#domain-policy-example
   */
  grantDefaultPolicy(principal: iam.IPrincipal): iam.Grant {
    const p = principal;
    this.grantLogin(p);
    this.grantCreate(p);
    return this.grantRead(p);
  }

  /**
     * Adds read actions for the principal to the domain's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/domain-spolicies.html
     */
  public grantRead(principal: iam.IPrincipal): iam.Grant {
    return this.grant(principal, DOMAIN_READ_ACTIONS);
  }
  /**
     * Adds GetAuthorizationToken for the principal to the domain's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/domain-policies.html
     */
  public grantLogin(principal: iam.IPrincipal): iam.Grant {
    return this.grant(principal, DOMAIN_LOGIN_ACTIONS);
  }
  /**
     * Adds CreateRepository for the principal to the domain's
     * resource policy
     * @param principal The principal for the policy
     * @see https://docs.aws.amazon.com/codeartifact/latest/ug/domain-policies.html
     */
  public grantCreate(principal: iam.IPrincipal): iam.Grant {
    return this.grant(principal, DOMAIN_CREATE_ACTIONS);
  }
}
