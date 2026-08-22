package com.quant.app.data.network

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * 币安 API 签名器。
 * 规则:查询参数按 ASCII 字母序排序拼接 → 追加 timestamp/recvWindow → HMAC-SHA256(secretKey)。
 */
object BinanceSigner {

    private const val HMAC_ALGO = "HmacSHA256"

    fun sign(queryString: String, secretKey: String): String {
        val mac = Mac.getInstance(HMAC_ALGO)
        mac.init(SecretKeySpec(secretKey.toByteArray(Charsets.UTF_8), HMAC_ALGO))
        val bytes = mac.doFinal(queryString.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * 将参数按 ASCII 字母序排序并拼接为 a=1&b=2 形式。
     * 币安要求除 signature 外所有参数参与签名,且必须字母序。
     */
    fun buildQueryString(params: Map<String, String>): String =
        params.entries
            .filter { it.key != "signature" }
            .sortedBy { it.key }
            .joinToString("&") { "${it.key}=${it.value}" }
}
