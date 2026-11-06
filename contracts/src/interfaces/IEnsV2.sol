// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Subsets of the Sepolia ENSv2 contracts Listing Day calls, transcribed from `ensdomains/contracts-v2` tag
///         `v2-mainnet-deployment-1` (commit 62778d8). Signatures match `contracts/deployments/sepolia/*.json` at
///         that tag; the full ABIs for the frontend are vendored in `abis/ensv2/`.
/// @dev Every ENSv2 resolver setter takes a DNS-encoded name (`EnsNames.dnsEncode`), not a namehash. Registry
///      functions that take `anyId` accept a labelhash, any version of the token id, or the EAC resource.

/// @notice `access-control/interfaces/IEACGrantInitializable.sol` (also used by `PermissionedResolver.initialize`).
struct Grant {
    address account;
    uint256 roleBitmap;
}

/// @notice `src/registry/interfaces/IRegistry.sol`.
interface IEnsRegistry {
    function getSubregistry(string calldata label) external view returns (IEnsRegistry);
    function getResolver(string calldata label) external view returns (address);
    function getParent() external view returns (IEnsRegistry parent, string memory label);
}

/// @notice `src/registry/PermissionedRegistry.sol` (the .eth registry and every `UserRegistry` proxy).
interface IEnsPermissionedRegistry is IEnsRegistry {
    event LabelRegistered(
        uint256 indexed tokenId,
        bytes32 indexed labelHash,
        string label,
        address owner,
        uint64 expiry,
        address indexed sender
    );
    event LabelUnregistered(uint256 indexed tokenId, address indexed sender);
    event TokenRegenerated(uint256 indexed oldTokenId, uint256 indexed newTokenId);
    event SubregistryUpdated(uint256 indexed tokenId, IEnsRegistry indexed subregistry, address indexed sender);
    event ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender);
    event ParentUpdated(IEnsRegistry indexed parent, string label, address indexed sender);

    error TransferDisallowed(uint256 tokenId, address from);
    error TransferUnsafeUntilRegistryIsEmancipated();
    error LabelAlreadyRegistered(string label);
    error LabelExpired(uint256 tokenId);
    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);

    function register(
        string calldata label,
        address owner,
        IEnsRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    function unregister(uint256 anyId) external;
    function setSubregistry(uint256 anyId, IEnsRegistry registry) external;
    function setResolver(uint256 anyId, address resolver) external;
    function setParent(IEnsRegistry parent, string calldata label) external;
    function grantRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);

    function findTokenId(string calldata label) external view returns (uint256);
    function findOwner(string calldata label) external view returns (address);
    function findExpiry(string calldata label) external view returns (uint64);
    function getTokenId(uint256 anyId) external view returns (uint256);
    function getOwner(uint256 anyId) external view returns (address);
    function getExpiry(uint256 anyId) external view returns (uint64);
    function getResource(uint256 anyId) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function latestOwnerOf(uint256 tokenId) external view returns (address);
    function roles(uint256 anyId, address account) external view returns (uint256);
    function hasRoles(uint256 anyId, uint256 roleBitmap, address account) external view returns (bool);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function isEmancipated() external view returns (bool);

    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
    function unsafeTransfer(address to, uint256 tokenId, bytes calldata data) external;
}

/// @notice `src/registry/UserRegistry.sol`: deployed per parent name through `VerifiableFactory.deployProxy`.
interface IEnsUserRegistry is IEnsPermissionedRegistry {
    function initialize(Grant[] calldata grants) external;
}

/// @notice `src/registrar/ETHRegistrar.sol` + `IETHRegistrar.sol`.
interface IEnsEthRegistrar {
    event CommitmentMade(bytes32 commitment);
    event NameRegistered(
        uint256 indexed tokenId,
        string label,
        address owner,
        IEnsRegistry subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 indexed referrer,
        uint256 base,
        uint256 premium
    );

    error UnexpiredCommitmentExists(bytes32 commitment);
    error CommitmentTooNew(bytes32 commitment, uint64 validFrom, uint64 blockTimestamp);
    error CommitmentTooOld(bytes32 commitment, uint64 validTo, uint64 blockTimestamp);
    error NameNotAvailable(string label);
    error DurationTooShort(uint64 duration, uint64 minDuration);

    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function MAX_COMMITMENT_AGE() external view returns (uint64);
    function MIN_REGISTER_DURATION() external view returns (uint64);
    function BENEFICIARY() external view returns (address);
    function ETH_REGISTRY() external view returns (address);

    function commit(bytes32 commitment) external;
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        IEnsRegistry subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256 tokenId);
    function commitmentAt(bytes32 commitment) external view returns (uint64);
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        IEnsRegistry subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
    function isAvailable(string calldata label) external view returns (bool);
    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);
}

/// @notice `src/resolver/PermissionedResolver.sol`. Roles are checked on the setter's argument resource (the text
///         key, coin type, ...) or on root, never per name: a scoped `ROLE_SET_TEXT` for one key covers that key on
///         every name the resolver holds records for. Hence one resolver per issuer.
interface IEnsPermissionedResolver {
    event TextUpdated(uint256 indexed recordId, string indexed keyHash, string key, string value);
    event AddressUpdated(uint256 indexed recordId, uint256 coinType, bytes addressBytes);
    event ResourceArgument(uint256 indexed resource, bytes arg);

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
    error UnsupportedResolverProfile(bytes4 selector);

    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;
    function multicall(bytes[] calldata calls) external returns (bytes[] memory results);
    /// @param setter ABI-encoded setter calldata, e.g. `abi.encodeCall(setText, (name, key, ""))`: only the
    ///        selector and the argument (key) matter. The caller needs the setter's admin role (`ROLE_SET_TEXT_ADMIN`).
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    /// @notice Always reverts `EACCannotGrantRoles`: use `grantSetterRoles`.
    function grantRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    function decodeSetter(bytes calldata setter)
        external
        pure
        returns (bytes memory arg, uint256 resource, uint256 roleBitmap);
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function roles(uint256 resource, address account) external view returns (uint256);
    /// @notice ENSIP-10 read; the first argument of `data` (the node) is ignored, `name` selects the record.
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// @notice `ensdomains/verifiable-factory` as deployed on Sepolia.
interface IEnsVerifiableFactory {
    event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation);

    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
    function predictProxyAddress(address deployer, uint256 salt) external view returns (address);
}

/// @notice `src/universalResolver/UniversalResolverV2.sol`, reached through the `0xeEeE…EeEe` proxy.
interface IEnsUniversalResolver {
    error ResolverNotFound(bytes name);
    error ResolverError(bytes errorData);

    /// @notice What viem's `getEnsAddress` / `getEnsText` call, with `gateways = ["x-batch-gateway:true"]`.
    function resolveWithGateways(bytes calldata name, bytes calldata data, string[] calldata gateways)
        external
        view
        returns (bytes memory result, address resolver);
    function findResolver(bytes calldata name) external view returns (address resolver, bytes32 node, uint256 offset);
}

// The PermissionedResolver has no direct `addr` / `text` views: these profiles are only ever ABI-encoded as the
// `data` of `resolve(dnsName, data)` (ENSIP-10) or `UniversalResolver.resolveWithGateways`.

/// @notice ENSIP-1 `addr(bytes32)`: viem `getEnsAddress` without a `coinType`. Encoded into `resolveWithGateways`.
interface IEnsAddrProfile {
    function addr(bytes32 node) external view returns (address);
}

/// @notice ENSIP-9 `addr(bytes32,uint256)`: viem `getEnsAddress({ coinType })`.
interface IEnsAddressProfile {
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory);
}

/// @notice ENSIP-5 `text(bytes32,string)`: viem `getEnsText`.
interface IEnsTextProfile {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @notice ENS test payment token (`MockUSDC` / `MockDAI`): ERC-20 with a public `mint`.
interface IEnsMockERC20 {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}
