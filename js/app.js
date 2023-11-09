let network
let bitcoinPrice
let recommendedFeeRate
let modulesInitializedPromise
let inscriptionData
let authorData
let mintAddress

const txHexByIdCache = {}
const mintValue = 1_000_000
const baseMempoolUrl = "https://mempool.space"
const baseMempoolApiUrl = "https://mempool.space/api"
const bitcoinPriceApiUrl = "https://blockchain.info/ticker?cors=true"
const ordinalsExplorerUrl = "https://ordinals.com"
const feeLevel = "economyFee" // "fastestFee" || "halfHourFee" || "hourFee" || "economyFee" || "minimumFee"

window.addEventListener('DOMContentLoaded', (event) => {
    const imageContainer = document.getElementById('image-container');
    const title = document.getElementById('title-container');
    const authorsUrl = 'static/artists.json';
    const imagesUrl = 'static/art.json';

    title.style.opacity = '1';

    Promise.all([fetch(authorsUrl), fetch(imagesUrl)])
        .then(responses => Promise.all(responses.map(response => response.json())))
        .then(([authors, imagesData]) => {
            const shuffledImages = shuffleArray(imagesData);

            shuffledImages.forEach(image => {
                const imgElement = document.createElement('img');
                imgElement.src = `art/${image.filename}`;
                imageContainer.appendChild(imgElement);

                const author = authors.find(author => author.authorId === image.authorId);
                const description = `${image.title} (by ${author.name})`;

                imgElement.addEventListener('mouseover', () => dimOtherImages(imgElement));
                imgElement.addEventListener('mouseout', () => undimImages());
                imgElement.addEventListener('click', () => {
                    artOpen(image, author);
                });
                
            });

            // Delay the display of images to match your original flow
            setTimeout(() => {
                imageContainer.style.opacity = '1';
                title.style.opacity = '0';
            }, 2000);

            setTimeout(() => { title.remove(); }, 3000);
        })
        .catch(error => {
            console.error('Error loading JSON:', error);
        });
    
});

function dimOtherImages(imageToExclude) {
    const allImages = document.querySelectorAll('#image-container img');

    allImages.forEach(img => {
        if (img !== imageToExclude) {
            img.classList.add('dimmed');
        }
    });
}

function undimImages() {
    const allImages = document.querySelectorAll('#image-container img');

    allImages.forEach(img => {
        img.classList.remove('dimmed');
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; // Swap elements
    }
    return array;
}

async function aboutAmystikaOpen() {
    document.getElementById('aboutAmystikaDialog').showModal();
}

async function aboutAmystikaClose() {
    document.getElementById('aboutAmystikaDialog').close();
}

async function faqOpen() {
    document.getElementById('faqDialog').showModal();
}

async function faqClose() {
    document.getElementById('faqDialog').close();
}

async function artOpen(image, author) {
    await modulesInitializedPromise
    
    inscriptionData = image
    authorData = author

    for (const elmnt of document.getElementsByClassName('artTitle')) {
        elmnt.textContent = inscriptionData.title;
    }
    for (const elmnt of document.getElementsByClassName('artistName')) {
        elmnt.textContent = authorData.name;
    }
    for (const elmnt of document.getElementsByClassName('artDescription')) {
        elmnt.innerHTML = inscriptionData.description.replaceAll("\n", "<br>");
    }
    for (const elmnt of document.getElementsByClassName('artPiece')) {
        elmnt.src = `art/${inscriptionData.filename}`;
    }

    if (image.isminted === false) {
        document.getElementById('inscriptionName').textContent = inscriptionData.title;
        document.getElementById('mintAddr').textContent = inscriptionData.mintaddress;
        mintAddress = inscriptionData.mintaddress;
        await getAddressTxIds(mintAddress).then(tx => {
            if (tx) {
                document.getElementById('btnMintInscription').style.display = 'none'
                document.getElementById('inscriptionSold').style.display = 'revert'
            } else {
                document.getElementById('btnMintInscription').style.display = 'revert'
                document.getElementById('inscriptionSold').style.display = 'none'
            }
        })
        document.getElementById('artMintDialog').showModal();
    } else {
        await loadInscription();
        document.getElementById('artDialog').showModal();
    }
}

async function artClose() {
    document.getElementById('artDialog').close()
    document.getElementById('artMintDialog').close()
}

async function mintOpen(){
    document.getElementById('payerAddress').value = localStorage.getItem('payerAddress') || ''
    if (document.getElementById('payerAddress').value) {
        updatePayerAddress()
    }
    recommendedFeeRate = fetch(`${baseMempoolApiUrl}/v1/fees/recommended`)
        .then(response => response.json())
        .then(data => data[feeLevel])
    document.getElementById('mintDialog').showModal()
}

async function mintClose() {
    document.getElementById('mintDialog').close()
}

async function updatePayerAddress() {
    const payerAddress = document.getElementById('payerAddress').value
    localStorage.setItem('payerAddress', payerAddress)

    document.getElementById('loadingUTXOs').style.display = 'block'
    try {
        payerUtxos = await getAddressUtxos(payerAddress)
    } catch (e) {
        document.getElementById('payerAddress').classList.add('is-invalid')
        document.getElementById('btnBuyInscription').disabled = true
        return console.error(e)
    } finally {
        document.getElementById('loadingUTXOs').style.display = 'none'
    }

    let minimumValueRequired = mintValue
    let vins = 1
    let vouts = 2

    try {
        paymentUtxos = await selectUtxos(payerUtxos, minimumValueRequired, vins, vouts, await recommendedFeeRate)
    } catch (e) {
        paymentUtxos = undefined
        console.error(e)
        document.getElementById('payerAddress').classList.add('is-invalid')
        document.getElementById('btnBuyInscription').disabled = true
        return alert(e)
    }

    document.getElementById('payerAddress').classList.remove('is-invalid')
    document.getElementById('btnBuyInscription').disabled = false
}

async function getAddressUtxos(address) {
    return await fetch(`${baseMempoolApiUrl}/address/${address}/utxo`)
        .then(response => response.json())
}

async function selectUtxos(utxos, amount, vins, vouts, recommendedFeeRate) {
    const selectedUtxos = []
    let selectedAmount = 0

    // Sort descending by value
    utxos = utxos.sort((a, b) => b.value - a.value)

    for (const utxo of utxos) {
        // Never spend a utxo that contains an inscription for cardinal purposes
        //if (await doesUtxoContainInscription(utxo)) {
        //    continue
        //}
        selectedUtxos.push(utxo)
        selectedAmount += utxo.value

        if (selectedAmount >= amount + calculateFee(vins + selectedUtxos.length, vouts, recommendedFeeRate)) {
            break
        }
    }

    if (selectedAmount < amount) {
        throw new Error(`Not enough cardinal spendable funds.
Address has:  ${satToBtc(selectedAmount)} BTC
Needed:          ${satToBtc(amount)} BTC

UTXOs:
${utxos.map(x => `${x.txid}:${x.vout}`).join("\n")}`)
    }

    return selectedUtxos
}

async function doesUtxoContainInscription(utxo) {
    const html = await fetch(`${ordinalsExplorerUrl}/output/${utxo.txid}:${utxo.vout}`)
        .then(response => response.text())

    return html.match(/class=thumbnails/) !== null
}

function calculateFee(vins, vouts, recommendedFeeRate, includeChangeOutput = true) {
    const baseTxSize = 10
    const inSize = 180
    const outSize = 34

    const txSize = baseTxSize + (vins * inSize) + (vouts * outSize) + (includeChangeOutput * outSize)
    const fee = txSize * recommendedFeeRate

    return fee
}

function btcToSat(btc) {
    return Math.floor(Number(btc) * Math.pow(10, 8))
}

function satToBtc(sat) {
    return Number(sat) / Math.pow(10, 8)
}

document.getElementById('btnBuyInscription').onclick = async () => {
    const receiverAddress = mintAddress
    const payerAddress = document.getElementById('payerAddress').value
    const price = mintValue

    try {
        psbt = await generatePSBTBuyingInscription(payerAddress, receiverAddress, price, paymentUtxos)
    } catch (e) {
        return alert(e)
    }

    const sellerOutputValueBtc = satToBtc(price)
    const sellPriceText = `${sellerOutputValueBtc} BTC ($${(sellerOutputValueBtc * await bitcoinPrice).toFixed(2)})`
    await displayBuyPsbt(psbt, payerAddress, `Sign and broadcast this transaction to mint NFT for ${sellPriceText}`, `Success! NFT bought successfully for ${sellPriceText}!`)
}

displayBuyPsbt = async (psbt, payerAddress, title, successMessage) => {
    document.getElementById('buyStep1').style.display = 'none'
    document.getElementById('buyStep2').style.display = 'revert'
    document.getElementById('mintDialog').showModal()

    document.getElementById('generatedBuyPsbtTitle').textContent = title
    document.getElementById('generatedBuyPsbt').value = psbt;
    (new QRCode('buyPsbtQrCode', { width: 300, height: 300, correctLevel: QRCode.CorrectLevel.L })).makeCode(psbt)

    const payerCurrentMempoolTxIds = await getAddressMempoolTxIds(payerAddress)
    const interval = setInterval(async () => {
        const txId = (await getAddressMempoolTxIds(payerAddress)).find(txId => !payerCurrentMempoolTxIds.includes(txId))

        if (txId) {
            clearInterval(interval)
            document.getElementById('buyStatusMessage').innerHTML = `${successMessage}
<br><br>
See transaction details on <a href="${baseMempoolUrl}/tx/${txId}" target="_blank">block explorer</a>.`
        }
    }, 5_000)
}

generatePSBTBuyingInscription = async (payerAddress, receiverAddress, price, paymentUtxos) => {
    const psbt = new bitcoin.Psbt({ network });
    let totalValue = 0
    let totalPaymentValue = 0

    // Add payment utxo inputs
    for (const utxo of paymentUtxos) {
        const tx = bitcoin.Transaction.fromHex(await getTxHexById(utxo.txid))
        for (const output in tx.outs) {
            try { tx.setWitness(parseInt(output), []) } catch { }
        }

        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            nonWitnessUtxo: tx.toBuffer(),
            // witnessUtxo: tx.outs[utxo.vout],
        });

        totalValue += utxo.value
        totalPaymentValue += utxo.value
    }

    psbt.addOutput({
        address: receiverAddress,
        value: price,
    });

    const fee = calculateFee(psbt.txInputs.length, psbt.txOutputs.length, await recommendedFeeRate)

    const changeValue = totalValue - price - fee

    if (changeValue < 0) {
        throw `Your wallet address doesn't have enough funds to mint this NFT.
Price:          ${satToBtc(price)} BTC
Fees:       ${satToBtc(fee)} BTC
You have:   ${satToBtc(totalPaymentValue)} BTC
Required:   ${satToBtc(totalValue - changeValue)} BTC
Missing:     ${satToBtc(-changeValue)} BTC`
    }

    // Change utxo
    psbt.addOutput({
        address: payerAddress,
        value: changeValue,
    });

    return psbt.toBase64();
}

async function getAddressMempoolTxIds(address) {
    return await fetch(`${baseMempoolApiUrl}/address/${address}/txs/mempool`)
        .then(response => response.json())
        .then(txs => txs.map(tx => tx.txid))
}

async function loadInscription(){
    try {
        inscription = await getInscriptionDataById(inscriptionData.inscriptionId, inscriptionData.inscriptionNumber);
    } catch (e) {
        return alert(e.message)
    }

    document.getElementById('inscriptionNumber').value = inscription.number;
    document.getElementById('inscriptionId').value = inscription.id;
    document.getElementById('owner').value = inscription.address;
    document.getElementById('utxo').value = inscription.output;
    document.getElementById('contentValue').value = inscription["content type"];

    document.getElementById('explorerLink').href = getExplorerLink(inscription.id)
}

async function getInscriptionDataById(inscriptionId, verifyIsInscriptionNumber) {
    const html = await fetch(ordinalsExplorerUrl + "/inscription/" + inscriptionId)
        .then(response => response.text())

    const data = [...html.matchAll(/<dt>(.*?)<\/dt>\s*<dd.*?>(.*?)<\/dd>/gm)]
        .map(x => { x[2] = x[2].replace(/<.*?>/gm, ''); return x })
        .reduce((a, b) => { return { ...a, [b[1]]: b[2] } }, {});

    const error = `Inscription ${verifyIsInscriptionNumber || inscriptionId} not found (maybe you're on signet and looking for a mainnet inscription or vice versa)`
    try {
        data.number = html.match(/<h1>Inscription (\d*)<\/h1>/)[1]
    } catch { throw new Error(error) }
    if (verifyIsInscriptionNumber && String(data.number) != String(verifyIsInscriptionNumber)) {
        throw new Error(error)
    }

    return data
}

async function getAddressTxIds(address) {
    return await fetch(`${baseMempoolApiUrl}/address/${address}/txs`)
        .then(response => response.json())
        .then(transactions => {
            // Sorting the transactions based on block_time in ascending order
            transactions.sort((a, b) => a.status.block_time - b.status.block_time);

            // Finding the earliest transaction with a value of 1,000,000 or greater
            return transactions.find(tx => {
                return tx.vout.some(vout => vout.value >= mintValue);
            });
        });
}

async function getTxHexById(txId) {
    if (!txHexByIdCache[txId]) {
        txHexByIdCache[txId] = await fetch(`${baseMempoolApiUrl}/tx/${txId}/hex`)
            .then(response => response.text())
    }

    return txHexByIdCache[txId]
}

function getExplorerLink(inscriptionId) {
    return `${ordinalsExplorerUrl}/inscription/${inscriptionId.replace(':', 'i')}`
}

function copyInput(btn, inputId) {
    const input = document.getElementById(inputId)
    input.select()
    input.setSelectionRange(0, 9999999)

    navigator.clipboard.writeText(input.value)

    const originalBtnTest = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(() => btn.textContent = originalBtnTest, 200)
}

function downloadInput(inputId, filename) {
    const input = document.getElementById(inputId)
    const hiddenElement = document.createElement('a');
    hiddenElement.href = 'data:attachment/text,' + encodeURI(input.value);
    hiddenElement.target = '_blank';
    hiddenElement.download = filename;
    hiddenElement.click();
}

async function main() {
    bitcoinPrice = fetch(bitcoinPriceApiUrl)
        .then(response => response.json())
        .then(data => data.USD.last)
    
    recommendedFeeRate = fetch(`${baseMempoolApiUrl}/v1/fees/recommended`)
        .then(response => response.json())
        .then(data => data[feeLevel])

    modulesInitializedPromise = new Promise(resolve => {
        const interval = setInterval(() => {
            if (window.bitcoin && window.secp256k1) {
                bitcoin.initEccLib(secp256k1)
                clearInterval(interval)
                resolve()
            }
        }, 50)
    })

    await modulesInitializedPromise
    network = bitcoin.networks.bitcoin
}

window.onload = main()

const currDate = new Date()
const hoursMin = currDate.getHours().toString().padStart(2, '0') + ':' + currDate.getMinutes().toString().padStart(2, '0')
document.getElementById('time').textContent = hoursMin
