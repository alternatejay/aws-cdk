// https://docs.aws.amazon.com/codeartifact/latest/APIReference/API_GetRepositoryEndpoint.html
export enum PackageFormat {
    ANY = "*",
    CARGO = "cargo",
    GENERIC = "generic",
    MAVEN = "maven",
    NPM = "npm",
    NUGET = "nuget",
    PYPI = "pypi",
    RUBY = "ruby",
    SWIFT = "swift"
}
