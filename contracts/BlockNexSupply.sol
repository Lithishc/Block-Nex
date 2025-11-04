// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BlockNexSupply {
    address public owner;
    uint256 public nextProcId;
    uint256 public nextOfferId;

    struct Procurement {
        uint256 id;
        string dealerUid;
        string skuId;
        uint256 qty;
        uint64 createdAt;
        bool ordered;
    }

    struct Offer {
        uint256 id;
        uint256 procurementId;
        string supplierUid;
        uint256 price;
        string details;
        uint64 createdAt;
        bool accepted;
    }

    mapping(uint256 => Procurement) public procurements;
    mapping(uint256 => Offer) public offers;

    event ProcurementCreated(uint256 id, string dealerUid, string skuId, uint256 qty);
    event OfferSubmitted(uint256 id, uint256 procurementId, string supplierUid, uint256 price, string details);
    event OfferAccepted(uint256 procurementId, uint256 offerId, string supplierUid, string dealerUid);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createProcurement(string memory dealerUid, string memory skuId, uint256 qty)
        external
        onlyOwner
        returns (uint256)
    {
        uint256 id = ++nextProcId;
        procurements[id] = Procurement(id, dealerUid, skuId, qty, uint64(block.timestamp), false);
        emit ProcurementCreated(id, dealerUid, skuId, qty);
        return id;
    }

    function submitOffer(uint256 procurementId, string memory supplierUid, uint256 price, string memory details)
        external
        onlyOwner
        returns (uint256)
    {
        require(procurements[procurementId].id != 0, "proc not found");
        uint256 id = ++nextOfferId;
        offers[id] = Offer(id, procurementId, supplierUid, price, details, uint64(block.timestamp), false);
        emit OfferSubmitted(id, procurementId, supplierUid, price, details);
        return id;
    }

    function acceptOffer(uint256 procurementId, uint256 offerId) external onlyOwner {
        Procurement storage p = procurements[procurementId];
        require(p.id != 0, "proc not found");
        Offer storage o = offers[offerId];
        require(o.id != 0 && o.procurementId == procurementId, "offer mismatch");
        require(!o.accepted, "already accepted");
        o.accepted = true;
        p.ordered = true;
        emit OfferAccepted(procurementId, offerId, o.supplierUid, p.dealerUid);
    }
}