// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BeaconJobRegistry — on-chain job and offer commitments
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

    mapping(bytes32 => OfferCommitment) public offers;

    event OfferCommitted(bytes32 indexed offerId, bytes32 indexed jobId, bytes32 briefHash, uint256 price);
    event JobAuthorized(bytes32 indexed jobId, bytes32 indexed offerId, address payer);
    event JobClosed(bytes32 indexed jobId, bytes32 indexed offerId, uint8 result);

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

    function authorize(bytes32 offerId, address payer) external {
        OfferCommitment storage offer = offers[offerId];
        require(offer.jobId != bytes32(0), "unknown offer");
        require(!offer.authorized, "already authorized");
        offer.payer = payer;
        offer.authorized = true;
        emit JobAuthorized(offer.jobId, offerId, payer);
    }

    function closeJob(bytes32 offerId, JobResult result) external {
        OfferCommitment storage offer = offers[offerId];
        require(offer.jobId != bytes32(0), "unknown offer");
        require(offer.authorized, "not authorized");
        require(!offer.closed, "already closed");
        offer.closed = true;
        offer.result = result;
        emit JobClosed(offer.jobId, offerId, uint8(result));
    }
}
