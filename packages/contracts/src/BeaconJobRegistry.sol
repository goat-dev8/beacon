// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BeaconJobRegistry — on-chain job and offer commitments
/// @notice Offer commits are open; authorize/close are restricted to owner-granted roles
///         (typically Bound Work escrow/settler paths). This registry tracks job state only —
///         it does not hold funds. Per-job locks live in `BeaconEscrow`, separate from any
///         prepaid agent vault pool.
contract BeaconJobRegistry {
    enum JobResult {
        None,
        Pass,
        Fail
    }

    struct OfferCommitment {
        bytes32 jobId;
        bytes32 briefHash;
        bytes32 rubricHash;
        uint256 price;
        address payer;
        bool authorized;
        bool closed;
        JobResult result;
    }

    address public owner;

    /// @dev Addresses allowed to authorize jobs (e.g. escrow / settler).
    mapping(address => bool) public authorizers;
    /// @dev Addresses allowed to close jobs (e.g. settler after acceptance).
    mapping(address => bool) public closers;

    mapping(bytes32 => OfferCommitment) public offers;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AuthorizerUpdated(address indexed account, bool allowed);
    event CloserUpdated(address indexed account, bool allowed);
    event OfferCommitted(bytes32 indexed offerId, bytes32 indexed jobId, bytes32 briefHash, uint256 price);
    event JobAuthorized(bytes32 indexed jobId, bytes32 indexed offerId, address payer);
    event JobClosed(bytes32 indexed jobId, bytes32 indexed offerId, uint8 result);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAuthorizer() {
        require(msg.sender == owner || authorizers[msg.sender], "not authorizer");
        _;
    }

    modifier onlyCloser() {
        require(msg.sender == owner || closers[msg.sender], "not closer");
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAuthorizer(address account, bool allowed) external onlyOwner {
        require(account != address(0), "zero account");
        authorizers[account] = allowed;
        emit AuthorizerUpdated(account, allowed);
    }

    function setCloser(address account, bool allowed) external onlyOwner {
        require(account != address(0), "zero account");
        closers[account] = allowed;
        emit CloserUpdated(account, allowed);
    }

    function commitOffer(
        bytes32 offerId,
        bytes32 jobId,
        bytes32 briefHash,
        bytes32 rubricHash,
        uint256 price
    ) external {
        require(offers[offerId].jobId == bytes32(0), "offer exists");
        offers[offerId] = OfferCommitment({
            jobId: jobId,
            briefHash: briefHash,
            rubricHash: rubricHash,
            price: price,
            payer: address(0),
            authorized: false,
            closed: false,
            result: JobResult.None
        });
        emit OfferCommitted(offerId, jobId, briefHash, price);
    }

    /// @notice Authorize a committed offer. Restricted to owner or granted authorizer (escrow path).
    function authorize(bytes32 offerId, address payer) external onlyAuthorizer {
        OfferCommitment storage offer = offers[offerId];
        require(offer.jobId != bytes32(0), "unknown offer");
        require(!offer.authorized, "already authorized");
        require(payer != address(0), "zero payer");
        offer.payer = payer;
        offer.authorized = true;
        emit JobAuthorized(offer.jobId, offerId, payer);
    }

    /// @notice Close an authorized job. Restricted to owner or granted closer (settler path).
    function closeJob(bytes32 offerId, JobResult result) external onlyCloser {
        OfferCommitment storage offer = offers[offerId];
        require(offer.jobId != bytes32(0), "unknown offer");
        require(offer.authorized, "not authorized");
        require(!offer.closed, "already closed");
        require(result == JobResult.Pass || result == JobResult.Fail, "bad result");
        offer.closed = true;
        offer.result = result;
        emit JobClosed(offer.jobId, offerId, uint8(result));
    }
}
